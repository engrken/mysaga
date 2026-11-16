import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scheduleWeekdays } from "@/lib/schedule-days";

const audience = "engineering-hq:teacher-schedule";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
function page(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect SAGA schedule</title><main style="max-width:40rem;margin:3rem auto;padding:1rem;font:16px system-ui"><h1>Connect your SAGA schedule</h1>${body}</main></html>`, {
    status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }
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
async function readSchedule(token: string) {
  let claims;
  try {
    claims = (await jwtVerify(token, tokenKey(), { audience, issuer:"saga", algorithms:["HS256"] })).payload;
  } catch { return json({ error:"SAGA access expired or is invalid. Reconnect from your teacher account." }, 401); }
  if (!claims.sub || typeof claims.school !== "string" || typeof claims.term !== "string" || typeof claims.year !== "string") return json({ error:"Invalid schedule access." }, 401);
  const teacher = await prisma.user.findUnique({ where:{ id:claims.sub }, select:{
    role:true, schoolId:true, emailVerifiedAt:true, passwordChangedAt:true, emailIdentityChangedAt:true,
    school:{select:{isActive:true,subscriptionStatus:true,subscriptionExpiresAt:true}}
  } });
  if (!teacher || teacher.role!=="TEACHER" || teacher.schoolId!==claims.school || !teacher.emailVerifiedAt ||
      !teacher.school.isActive || teacher.school.subscriptionStatus!=="ACTIVE" ||
      (teacher.school.subscriptionExpiresAt && teacher.school.subscriptionExpiresAt<=new Date()) ||
      (teacher.passwordChangedAt?.getTime()??null)!==claims.password ||
      (teacher.emailIdentityChangedAt?.getTime()??null)!==claims.identity) return json({ error:"Reconnect from your SAGA teacher account." },401);
  const subjects=await prisma.subject.findMany({
    where:{schoolId:claims.school,teacherId:claims.sub,academicYear:claims.year,term:claims.term},
    select:{code:true,title:true,classId:true,schedule:true},orderBy:{code:"asc"}
  });
  const date=today(),weekday=new Date(date+"T00:00:00Z").getUTCDay();
  const classes=subjects.flatMap(subject=>meetings(subject.schedule??"",weekday).map(time=>({
    code:subject.code,title:subject.title,classId:subject.classId,time
  })));
  return json({date, term:claims.term, academicYear:claims.year, classes});
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
  return page(`<p>The link gives Engineering HQ read-only access to your class times and subject names for the term you select. It expires in 30 days.</p><form method="post"><label>Academic year and term <select name="term">${options}</select></label> <button>Generate connection code</button></form>`);
}
export async function POST(request: Request) {
  const url = new URL(request.url);
  if(request.headers.get("origin")!==url.origin)return page("<p>Open this page from SAGA and try again.</p>",403);
  const teacher=await requireRole("TEACHER");
  if(!teacher||teacher.isDemo)return page("<p>Sign in to SAGA as a teacher.</p>",401);
  let selection;
  try { selection = JSON.parse(String((await request.formData()).get("term"))); } catch { return page("<p>Choose a valid term.</p>",400); }
  if(!Array.isArray(selection)||selection.length!==2||!selection.every(value=>typeof value==="string"&&value.length<=80))return page("<p>Choose a valid term.</p>",400);
  const [year,term]=selection;
  if(!await prisma.subject.findFirst({where:{schoolId:teacher.schoolId,teacherId:teacher.id,academicYear:year,term},select:{id:true}}))return page("<p>Choose one of your own class terms.</p>",403);
  const identity=await prisma.user.findUniqueOrThrow({where:{id:teacher.id},select:{passwordChangedAt:true,emailIdentityChangedAt:true}});
  const token=await new SignJWT({
    school:teacher.schoolId,year,term,password:identity.passwordChangedAt?.getTime()??null,identity:identity.emailIdentityChangedAt?.getTime()??null
  }).setProtectedHeader({alg:"HS256"}).setIssuer("saga").setAudience(audience).setSubject(teacher.id).setIssuedAt().setExpirationTime("30d").sign(tokenKey());
  return page(`<p>Copy this code into Engineering HQ’s SAGA schedule connection. Treat it like a password.</p><textarea readonly rows="8" cols="50" aria-label="Connection code">${escapeHtml(token)}</textarea>`);
}
