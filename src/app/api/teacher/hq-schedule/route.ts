import { createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { scheduleWeekdays } from "@/lib/schedule-days";

const audience = "engineering-hq:teacher-schedule";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
function page(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect SAGA schedule</title><main style="max-width:40rem;margin:3rem auto;padding:1rem;font:16px system-ui"><h1>Connect your SAGA schedule</h1>${body}</main></html>`, {
    status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }
  });
}
function tokenKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Schedule linking is unavailable.");
  return createHmac("sha256", secret).update(audience).digest();
}
function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function meetings(raw: string, weekday: number): string[] {
  try {
    const rows: unknown = JSON.parse(raw);
    if (Array.isArray(rows)) {
      return rows.flatMap(row => {
        if (!row || typeof row.day !== "string" || !scheduleWeekdays(JSON.stringify([{ day: row.day }])).includes(weekday)) return [];
        const values = [row.startTime, row.endTime].filter(value => typeof value === "string" && value);
        return [[typeof row.label === "string" && row.label || "Class", values.join("–")].filter(Boolean).join(" · ")];
      });
    }
  } catch { /* Legacy schedules are stored as free text. */ }
  return scheduleWeekdays(raw).includes(weekday) ? [raw] : [];
}
async function grant(token: string) {
  let claims;
  try {
    claims = (await jwtVerify(token, tokenKey(), { audience, issuer:"saga", algorithms:["HS256"] })).payload;
  } catch { return null; }
  if (!claims.sub || typeof claims.school !== "string" || typeof claims.term !== "string" || typeof claims.year !== "string") return null;
  const teacher = await prisma.user.findUnique({ where:{ id:claims.sub }, select:{
    role:true, schoolId:true, emailVerifiedAt:true, passwordChangedAt:true, emailIdentityChangedAt:true,
    school:{select:{isActive:true,subscriptionStatus:true,subscriptionExpiresAt:true}}
  } });
  if (!teacher || teacher.role!=="TEACHER" || teacher.schoolId!==claims.school || !teacher.emailVerifiedAt ||
      !teacher.school.isActive || teacher.school.subscriptionStatus!=="ACTIVE" ||
      (teacher.school.subscriptionExpiresAt && teacher.school.subscriptionExpiresAt<=new Date()) ||
      (teacher.passwordChangedAt?.getTime()??null)!==claims.password ||
      (teacher.emailIdentityChangedAt?.getTime()??null)!==claims.identity) return null;
  return {id:claims.sub, school:claims.school, term:claims.term, year:claims.year, scores:claims.scores===true};
}
type Grant = NonNullable<Awaited<ReturnType<typeof grant>>>;
const scope = (g: Grant) => ({schoolId:g.school,teacherId:g.id,academicYear:g.year,term:g.term});
async function readSchedule(token: string) {
  const g=await grant(token);
  if(!g)return json({error:"SAGA access expired or is invalid. Reconnect from your teacher account."},401);
  const subjects=await prisma.subject.findMany({
    where:scope(g),
    select:{code:true,title:true,classId:true,schedule:true},orderBy:{code:"asc"}
  });
  const date=today(),weekday=new Date(date+"T00:00:00Z").getUTCDay();
  const classes=subjects.flatMap(subject=>meetings(subject.schedule??"",weekday).map(time=>({
    code:subject.code,title:subject.title,classId:subject.classId,time
  })));
  return json({date, term:g.term, academicYear:g.year, classes});
}
export async function GET(request: Request) {
  const auth=request.headers.get("authorization");
  if(auth?.startsWith("Bearer "))return readSchedule(auth.slice(7));
  const teacher=await requireRole("TEACHER");
  if(!teacher||teacher.isDemo)return page("<p>Sign in to SAGA as a teacher in this browser, then reopen this page.</p>",401);
  const terms=await prisma.subject.findMany({
    where:{schoolId:teacher.schoolId,teacherId:teacher.id},select:{academicYear:true,term:true},
    distinct:["academicYear","term"],orderBy:[{academicYear:"desc"},{term:"asc"}]
  });
  if(!terms.length)return page("<p>No class terms were found in your SAGA account.</p>");
  const options=terms.map(({academicYear,term})=>`<option value="${escapeHtml(JSON.stringify([academicYear,term]))}">${escapeHtml(academicYear+" · "+term)}</option>`).join("");
  return page(`<p>The link gives Engineering HQ read-only access to your class times and subject names for the term you select. It expires in 30 days.</p><form method="post"><label>Academic year and term <select name="term">${options}</select></label><p><label><input type="checkbox" name="scores" value="yes"> Allow score comparison and adding confirmed missing scores for this term</label></p><button>Generate connection code</button></form>`);
}
export async function POST(request: Request) {
  const bearer=request.headers.get("authorization");
  if(bearer?.startsWith("Bearer "))return scoreRequest(request,bearer.slice(7));
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || (origin !== url.origin && origin !== "https://mysaga.vercel.app")) return page("<p>Open this page from SAGA and try again.</p>",403);
  const teacher=await requireRole("TEACHER");
  if(!teacher||teacher.isDemo)return page("<p>Sign in to SAGA as a teacher.</p>",401);
  let selection, scores=false;
  try { const form=await request.formData(); selection = JSON.parse(String(form.get("term"))); scores=form.get("scores")==="yes"; } catch { return page("<p>Choose a valid term.</p>",400); }
  if(!Array.isArray(selection)||selection.length!==2||!selection.every(value=>typeof value==="string"&&value.length<=80))return page("<p>Choose a valid term.</p>",400);
  const [year,term]=selection;
  if(!await prisma.subject.findFirst({where:{schoolId:teacher.schoolId,teacherId:teacher.id,academicYear:year,term},select:{id:true}}))return page("<p>Choose one of your own class terms.</p>",403);
  const identity=await prisma.user.findUniqueOrThrow({where:{id:teacher.id},select:{passwordChangedAt:true,emailIdentityChangedAt:true}});
  const token=await new SignJWT({
    school:teacher.schoolId,year,term,scores,password:identity.passwordChangedAt?.getTime()??null,identity:identity.emailIdentityChangedAt?.getTime()??null
  }).setProtectedHeader({alg:"HS256"}).setIssuer("saga").setAudience(audience).setSubject(teacher.id).setIssuedAt().setExpirationTime("30d").sign(tokenKey());
  return page(`<p>Copy this code into Engineering HQ’s SAGA schedule connection. Treat it like a password.</p><textarea readonly rows="8" cols="50" aria-label="Connection code">${escapeHtml(token)}</textarea>`);
}

const previewAudience="engineering-hq:missing-score-preview";
const targetId=z.string().min(1).max(100);
const numeric=z.number().finite().min(0);
const requestSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("classes")}),
  z.object({action:z.literal("preview"),subjectId:targetId,assessmentId:targetId,maximum:numeric.positive(),
    identity:z.enum(["id","name"]),rows:z.array(z.object({row:z.number().int().positive(),key:z.string().trim().min(1).max(200),points:numeric.nullable()})).min(1).max(500)}),
  z.object({action:z.literal("apply"),preview:z.string().min(1).max(100000)})
]);
const manifestSchema=z.object({subjectId:targetId,assessmentId:targetId,maximum:numeric.positive(),
  entries:z.array(z.object({enrollment:targetId,points:numeric})).min(1).max(500)});
const normalName=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toUpperCase();
const normalId=(value:string)=>value.trim().toUpperCase();
const attendance=(title:string)=>title.toLowerCase().startsWith("attendance ·");

async function scoreRequest(request: Request, token:string) {
  const g=await grant(token);
  if(!g)return json({error:"SAGA access expired. Reconnect from your teacher account."},401);
  if(!g.scores)return json({error:"Reconnect SAGA with score comparison and missing-score access enabled."},403);
  const raw=await request.text();
  if(raw.length>175000)return json({error:"The score request is too large."},413);
  let body;
  try { body=JSON.parse(raw); } catch { return json({error:"Invalid score request."},400); }
  const parsed=requestSchema.safeParse(body);
  if(!parsed.success)return json({error:"Check the subject, assessment, and score rows. Each batch supports up to 500 rows."},400);
  const input=parsed.data;
  if(input.action==="classes"){
    const subjects=await prisma.subject.findMany({where:scope(g),orderBy:{code:"asc"},
      select:{id:true,title:true,code:true,classId:true,courseYear:true,gradeStatus:true,
        assessments:{where:{activity:null},select:{id:true,title:true,maxScore:true},orderBy:{title:"asc"}}}});
    return json({academicYear:g.year,term:g.term,subjects:subjects.map(subject=>({
      ...subject,assessments:subject.assessments.filter(item=>!attendance(item.title))
    }))});
  }
  if(input.action==="apply")return applyMissing(g,input.preview);
  const subject=await prisma.subject.findFirst({where:{...scope(g),id:input.subjectId},
    select:{id:true,gradeStatus:true,assessments:{where:{id:input.assessmentId,activity:null},select:{id:true,title:true,maxScore:true}},
      enrollments:{select:{id:true,studentNumber:true,studentName:true,
        scores:{where:{assessmentId:input.assessmentId},select:{points:true,remark:true}}}}}});
  const assessment=subject?.assessments[0];
  if(!subject||!assessment||attendance(assessment.title))return json({error:"Choose an assessment from your selected class."},404);
  if(assessment.maxScore!==input.maximum)return json({error:"The workbook maximum differs from the SAGA assessment maximum."},409);
  const key=input.identity==="name"?normalName:normalId;
  const roster=new Map<string,typeof subject.enrollments>();
  for(const row of subject.enrollments){
    const value=key(input.identity==="name"?row.studentName:row.studentNumber??"");
    if(value)roster.set(value,[...(roster.get(value)??[]),row]);
  }
  const frequency=new Map<string,number>();
  for(const row of input.rows)frequency.set(key(row.key),(frequency.get(key(row.key))??0)+1);
  const entries:Array<{enrollment:string;points:number}>=[];
  const rows=input.rows.map(row=>{
    const normalized=key(row.key), matches=roster.get(normalized)??[];
    const payload={row:row.row,input:row.points};
    if((frequency.get(normalized)??0)>1||matches.length>1)return {...payload,status:"ambiguous"};
    if(!matches.length)return {...payload,status:"unmatched"};
    const current=matches[0].scores[0], saga=current?.points??null, remark=current?.remark??null;
    if(row.points===null)return {...payload,saga,remark,status:"workbook-blank"};
    if(row.points>assessment.maxScore)return {...payload,saga,remark,status:"out-of-range"};
    if(remark!==null||saga!==null)return {...payload,saga,remark,status:saga===row.points&&remark===null?"same":"different"};
    if(subject.gradeStatus==="VERIFIED")return {...payload,saga,remark,status:"locked"};
    entries.push({enrollment:matches[0].id,points:row.points});
    return {...payload,saga,remark,status:"missing"};
  });
  const unsafe=rows.some(row=>["ambiguous","unmatched","out-of-range","locked"].includes(row.status));
  const preview=!unsafe&&entries.length?await new SignJWT({subjectId:subject.id,assessmentId:assessment.id,maximum:assessment.maxScore,entries})
    .setProtectedHeader({alg:"HS256"}).setIssuer("saga").setAudience(previewAudience).setSubject(g.id)
    .setIssuedAt().setExpirationTime("10m").sign(tokenKey()):null;
  return json({rows,missing:entries.length,preview});
}
async function applyMissing(g:Grant, token:string){
  const proof=await jwtVerify(token,tokenKey(),{issuer:"saga",audience:previewAudience,subject:g.id,algorithms:["HS256"]}).catch(()=>null);
  const parsed=manifestSchema.safeParse(proof?.payload);
  if(!parsed.success)return json({error:"This preview expired or is invalid. Compare the workbook again."},409);
  const manifest=parsed.data;
  try{
    const result=await prisma.$transaction(async tx=>{
      const [subject]=await tx.$queryRaw<Array<{id:string;status:string}>>`
        SELECT "id", "gradeStatus"::text AS "status" FROM "Subject"
        WHERE "id"=${manifest.subjectId} AND "teacherId"=${g.id} AND "schoolId"=${g.school}
          AND "academicYear"=${g.year} AND "term"=${g.term} FOR UPDATE
      `;
      if(!subject||subject.status==="VERIFIED")return null;
      const [assessment]=await tx.$queryRaw<Array<{title:string;maxScore:number}>>`
        SELECT "title","maxScore" FROM "Assessment" WHERE "id"=${manifest.assessmentId}
          AND "subjectId"=${subject.id} FOR SHARE
      `;
      if(!assessment||attendance(assessment.title)||assessment.maxScore!==manifest.maximum||
         manifest.entries.some(entry=>entry.points>assessment.maxScore))return null;
      const values=manifest.entries.map(item=>Prisma.sql`(${randomUUID()},${item.enrollment},${manifest.assessmentId},${item.points}::double precision)`);
      const saved=await tx.$queryRaw<Array<{enrollmentId:string}>>(Prisma.sql`
        INSERT INTO "Score" ("id","enrollmentId","assessmentId","points","updatedAt")
        SELECT pending.id,pending.enrollment,pending.assessment,pending.points,CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(values)}) AS pending(id,enrollment,assessment,points)
        JOIN "Enrollment" AS e ON e."id"=pending.enrollment AND e."subjectId"=${subject.id}
        ON CONFLICT ("enrollmentId","assessmentId") DO UPDATE
          SET "points"=EXCLUDED."points","updatedAt"=CURRENT_TIMESTAMP
          WHERE "Score"."points" IS NULL AND "Score"."remark" IS NULL
        RETURNING "enrollmentId"
      `);
      if(saved.length)await tx.auditEvent.createMany({data:saved.map(row=>({
        actorId:g.id,entity:"score",entityId:row.enrollmentId+":"+manifest.assessmentId,action:"filled missing score from Engineering HQ"
      }))});
      return {saved:saved.length,skipped:manifest.entries.length-saved.length};
    });
    return result?json(result):json({error:"The assessment changed or the grade record is locked. Compare again."},409);
  }catch{return json({error:"SAGA could not save this batch. Compare again before retrying."},409);}
}
