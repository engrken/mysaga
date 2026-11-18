import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantManager } from "@/lib/auth";
import { sendPortalEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ schoolId: string }> };
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createSchema = z.object({
  description: z.string().trim().min(2).max(200),
  amount: z.number().positive().max(10000000),
  dueAt: dateOnly,
  note: z.string().trim().max(500).optional()
});

export async function GET(_request: Request, { params }: Context) {
  const manager = await requireTenantManager();
  if (!manager) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  const { schoolId } = await params;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) return NextResponse.json({ error: "School workspace not found." }, { status: 404 });
  const invoices = await prisma.tenantInvoice.findMany({
    where: { schoolId },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true, invoiceNumber: true, description: true, amount: true, currency: true,
      issuedAt: true, dueAt: true, status: true, paidAt: true, note: true
    }
  });
  return NextResponse.json({ invoices }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: Context) {
  const manager = await requireTenantManager();
  if (!manager) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  const { schoolId } = await params;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter an invoice description, amount, and valid due date." }, { status: 400 });
  const dueAt = new Date(`${parsed.data.dueAt}T00:00:00.000Z`);
  if (Number.isNaN(dueAt.getTime()) || dueAt.toISOString().slice(0, 10) !== parsed.data.dueAt) {
    return NextResponse.json({ error: "Choose a valid invoice due date." }, { status: 400 });
  }
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, billingEmail: true, users: { where: { isSchoolAdmin: true }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } } }
  });
  if (!school) return NextResponse.json({ error: "School workspace not found." }, { status: 404 });
  const invoiceNumber = `SAGA-${new Date().toISOString().slice(0, 7).replace("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  const invoice = await prisma.$transaction(async tx => {
    const created = await tx.tenantInvoice.create({
      data: {
        schoolId, invoiceNumber, description: parsed.data.description,
        amount: parsed.data.amount, dueAt, note: parsed.data.note || null,
        recordedBy: manager.email
      },
      select: {
        id: true, invoiceNumber: true, description: true, amount: true, currency: true,
        issuedAt: true, dueAt: true, status: true, paidAt: true, note: true
      }
    });
    await tx.auditEvent.create({
      data: { actorId: manager.id, action: `issued manual invoice ${invoiceNumber}`, entity: "tenant-invoice", entityId: created.id }
    });
    return created;
  });
  let emailSent = false;
  const recipient = school.billingEmail || school.users[0]?.email;
  if (recipient) {
    try {
      await sendPortalEmail({
        to: recipient,
        subject: `SAGA invoice ${invoice.invoiceNumber}`,
        text: `A manual invoice has been issued for ${school.name}.\n\nInvoice: ${invoice.invoiceNumber}\nDescription: ${invoice.description}\nAmount: ${invoice.currency} ${invoice.amount.toFixed(2)}\nDue date: ${invoice.dueAt.toISOString().slice(0, 10)}\n\nIf you have questions, contact your SAGA platform administrator.`
      });
      emailSent = true;
    } catch (error) {
      console.error("SAGA_TENANT_INVOICE_EMAIL_FAILED", error instanceof Error ? error.message : "unknown");
    }
  }
  return NextResponse.json({ ok: true, invoice, emailSent }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

const updateSchema = z.object({
  invoiceId: z.string().min(1).max(100),
  status: z.enum(["PAID", "VOID"]),
  method: z.string().trim().min(2).max(40).optional(),
  reference: z.string().trim().max(120).optional()
});

export async function PATCH(request: Request, { params }: Context) {
  const manager = await requireTenantManager();
  if (!manager) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  const { schoolId } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid invoice status and payment method." }, { status: 400 });
  const invoice = await prisma.tenantInvoice.findFirst({
    where: { id: parsed.data.invoiceId, schoolId },
    select: { id: true, status: true, amount: true, currency: true, dueAt: true, invoiceNumber: true }
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (invoice.status !== "ISSUED") return NextResponse.json({ error: "Only issued invoices can be marked paid or voided." }, { status: 409 });
  if (parsed.data.status === "PAID" && !parsed.data.method) {
    return NextResponse.json({ error: "Enter the payment method before marking an invoice paid." }, { status: 400 });
  }
  try {
    const updated = await prisma.$transaction(async tx => {
      if (parsed.data.status === "PAID" && parsed.data.reference) {
        const duplicate = await tx.tenantPayment.findFirst({
          where: { schoolId, reference: parsed.data.reference }, select: { id: true }
        });
        if (duplicate) throw new Error("DUPLICATE_PAYMENT_REFERENCE");
      }
      const saved = await tx.tenantInvoice.updateMany({
        where: { id: invoice.id, schoolId, status: "ISSUED" },
        data: { status: parsed.data.status, paidAt: parsed.data.status === "PAID" ? new Date() : null }
      });
      if (saved.count !== 1) throw new Error("INVOICE_CHANGED");
      if (parsed.data.status === "PAID") await tx.tenantPayment.create({
        data: {
          schoolId, amount: invoice.amount, currency: invoice.currency,
          method: parsed.data.method!, reference: parsed.data.reference || invoice.invoiceNumber,
          paidAt: new Date(), coverageTo: invoice.dueAt,
          note: `Payment for invoice ${invoice.invoiceNumber}`, recordedBy: manager.email
        }
      });
      await tx.auditEvent.create({
        data: {
          actorId: manager.id,
          action: parsed.data.status === "PAID" ? `recorded payment for invoice ${invoice.invoiceNumber}` : `voided invoice ${invoice.invoiceNumber}`,
          entity: "tenant-invoice", entityId: invoice.id
        }
      });
      return tx.tenantInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { id: true, invoiceNumber: true, description: true, amount: true, currency: true, issuedAt: true, dueAt: true, status: true, paidAt: true, note: true }
      });
    });
    return NextResponse.json({ ok: true, invoice: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_PAYMENT_REFERENCE") {
      return NextResponse.json({ error: "That payment reference is already recorded for this school." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "INVOICE_CHANGED") {
      return NextResponse.json({ error: "This invoice changed in another session. Refresh and try again." }, { status: 409 });
    }
    throw error;
  }
}
