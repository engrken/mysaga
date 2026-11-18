import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendPortalEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { daysUntil, todayManila } from "@/lib/tenant-operations";

const reminderDays = new Set([-7, -1, 0, 1, 7]);

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const today = todayManila();
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  end.setUTCDate(end.getUTCDate() + 8);
  const invoices = await prisma.tenantInvoice.findMany({
    where: {
      status: "ISSUED",
      dueAt: {
        gte: start,
        lt: end
      }
    },
    select: {
      id: true, invoiceNumber: true, description: true, amount: true, currency: true, dueAt: true,
      schoolId: true, school: {
        select: {
          name: true, billingEmail: true,
          users: { where: { isSchoolAdmin: true }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } }
        }
      }
    }
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const invoice of invoices) {
    const remaining = daysUntil(invoice.dueAt.toISOString(), today);
    if (remaining === null || !reminderDays.has(remaining)) {
      skipped += 1;
      continue;
    }
    const recipient = invoice.school.billingEmail || invoice.school.users[0]?.email;
    if (!recipient) {
      skipped += 1;
      continue;
    }
    try {
      await prisma.tenantInvoiceReminder.create({
        data: { invoiceId: invoice.id, daysFromDue: remaining }
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        skipped += 1;
        continue;
      }
      throw error;
    }
    try {
      const timing = remaining > 0 ? `due in ${remaining} day${remaining === 1 ? "" : "s"}`
        : remaining === 0 ? "due today"
        : `overdue by ${Math.abs(remaining)} day${remaining === -1 ? "" : "s"}`;
      await sendPortalEmail({
        to: recipient,
        subject: `SAGA invoice ${invoice.invoiceNumber} is ${timing}`,
        text: `Invoice ${invoice.invoiceNumber} for ${invoice.school.name} is ${timing}.\n\nDescription: ${invoice.description}\nAmount: ${invoice.currency} ${invoice.amount.toFixed(2)}\nDue date: ${invoice.dueAt.toISOString().slice(0, 10)}\n\nIf you have already paid, please contact the SAGA platform administrator.`
      });
      sent += 1;
    } catch (error) {
      await prisma.tenantInvoiceReminder.deleteMany({
        where: { invoiceId: invoice.id, daysFromDue: remaining }
      });
      failed += 1;
      console.error("SAGA_TENANT_INVOICE_REMINDER_FAILED", error instanceof Error ? error.message : "unknown");
    }
  }
  return NextResponse.json({ sent, skipped, failed }, { status: failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
