import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from './config/env.js';
import { prisma } from './db.js';
import { auth, permit } from './middleware/auth.js';
import { nextDocNo, postDocument, reverseDocument } from './utils/accounting.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: env.frontendUrl, credentials: true }));

const actionPerms: Record<string, string> = {
  create: 'DOC_CREATE', update: 'DOC_UPDATE', approve: 'DOC_APPROVE', post: 'DOC_POST', cancel: 'DOC_CANCEL', reverse: 'DOC_REVERSE', report: 'REPORT_VIEW'
};

app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'بيانات دخول غير صحيحة' });
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (!user) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور خاطئة' });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور خاطئة' });
  const token = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: '12h' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});
app.post('/api/auth/logout', (_, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/auth/me', auth, async (req, res) => res.json(req.user));

app.use('/api', auth);

app.get('/api/customers', permit(actionPerms.report), async (_, res) => res.json(await prisma.customer.findMany()));
app.post('/api/customers', permit(actionPerms.create), async (req, res) => res.json(await prisma.customer.create({ data: req.body })));
app.get('/api/suppliers', permit(actionPerms.report), async (_, res) => res.json(await prisma.supplier.findMany()));
app.post('/api/suppliers', permit(actionPerms.create), async (req, res) => res.json(await prisma.supplier.create({ data: req.body })));

app.get('/api/statements/customer/:id', permit(actionPerms.report), async (req, res) => {
  const rows = await prisma.subledgerEntry.findMany({ where: { subledgerType: 'CUSTOMER', referenceId: Number(req.params.id) }, orderBy: { entryDate: 'asc' } });
  res.json(rows);
});
app.get('/api/statements/supplier/:id', permit(actionPerms.report), async (req, res) => {
  const rows = await prisma.subledgerEntry.findMany({ where: { subledgerType: 'SUPPLIER', referenceId: Number(req.params.id) }, orderBy: { entryDate: 'asc' } });
  res.json(rows);
});

async function statusAction(entityType: string, id: number, action: 'APPROVE' | 'CANCEL', userId: number) {
  const model = (prisma as any)[entityType];
  const row = await model.findUnique({ where: { id } });
  if (!row) throw new Error('NOT_FOUND');
  if (action === 'APPROVE' && row.status !== 'DRAFT') throw new Error('ONLY_DRAFT_APPROVE');
  if (action === 'CANCEL' && row.status === 'POSTED') throw new Error('USE_REVERSE');
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'CANCELLED';
  const updated = await model.update({ where: { id }, data: { status: newStatus } });
  await prisma.documentStatusHistory.create({ data: { entityType, entityId: id, previousStatus: row.status, newStatus, action, changedBy: userId } });
  return updated;
}

app.post('/api/revenues', permit(actionPerms.create), async (req, res) => {
  const b = req.body;
  if (b.paymentType === 'CREDIT' && !b.customerId) return res.status(400).json({ message: 'العميل مطلوب للإيراد الآجل' });
  const docNo = await nextDocNo('REV', new Date(b.docDate));
  const row = await prisma.revenueHeader.create({ data: { ...b, docNo } });
  res.json(row);
});
app.get('/api/revenues', permit(actionPerms.report), async (_, res) => res.json(await prisma.revenueHeader.findMany()));
app.put('/api/revenues/:id', permit(actionPerms.update), async (req, res) => {
  const id = Number(req.params.id);
  const old = await prisma.revenueHeader.findUnique({ where: { id } });
  if (!old || old.status !== 'DRAFT') return res.status(400).json({ message: 'يسمح بالتعديل في المسودة فقط' });
  res.json(await prisma.revenueHeader.update({ where: { id }, data: req.body }));
});
app.post('/api/revenues/:id/approve', permit(actionPerms.approve), async (req, res) => res.json(await statusAction('revenueHeader', Number(req.params.id), 'APPROVE', req.user!.id)));
app.post('/api/revenues/:id/post', permit(actionPerms.post), async (req, res) => {
  const id = Number(req.params.id);
  const rev = await prisma.revenueHeader.findUnique({ where: { id } });
  if (!rev || rev.status !== 'APPROVED') return res.status(400).json({ message: 'يجب اعتماد المستند أولاً' });
  const cash = Number((await prisma.systemSetting.findUnique({ where: { key: 'default_cash_account_id' } }))?.value);
  const cust = Number((await prisma.systemSetting.findUnique({ where: { key: 'default_customer_control_account_id' } }))?.value);
  const cat = await prisma.revenueCategory.findUnique({ where: { id: rev.categoryId } });
  const je = await postDocument('revenue_headers', id, rev.docDate, req.user!.id, `ترحيل إيراد ${rev.docNo}`,
    [
      { accountId: rev.paymentType === 'CASH' ? cash : cust, debitIls: Number(rev.totalAmountIls), creditIls: 0 },
      { accountId: cat!.accountId, debitIls: 0, creditIls: Number(rev.totalAmountIls) }
    ],
    rev.paymentType === 'CREDIT' ? [{ subledgerType: 'CUSTOMER', referenceId: rev.customerId!, debitIls: Number(rev.totalAmountIls), creditIls: 0 }] : [],
    rev.paymentType === 'CASH' ? Number(rev.totalAmountIls) : 0);
  await prisma.revenueHeader.update({ where: { id }, data: { status: 'POSTED', postedJournalEntryId: je.id } });
  res.json({ ok: true, journalEntryId: je.id });
});

app.post('/api/revenues/:id/cancel', permit(actionPerms.cancel), async (req, res) => {
  const id = Number(req.params.id);
  const rev = await prisma.revenueHeader.findUnique({ where: { id } });
  if (!rev) return res.status(404).json({ message: 'غير موجود' });
  if (rev.status === 'POSTED') {
    const r = await reverseDocument('revenue_headers', id, new Date(), req.user!.id, req.body?.reason || 'إلغاء رقابي');
    await prisma.revenueHeader.update({ where: { id }, data: { status: 'CANCELLED' } });
    return res.json({ ok: true, reversedJournalEntryId: r.id });
  }
  const row = await statusAction('revenueHeader', id, 'CANCEL', req.user!.id);
  return res.json(row);
});

const simpleCreate = (path: string, model: any, prefix: string, dateField: string) => app.post(`/api/${path}`, permit(actionPerms.create), async (req, res) => {
  const docNo = await nextDocNo(prefix, new Date(req.body[dateField]));
  res.json(await model.create({ data: { ...req.body, docNo } }));
});
simpleCreate('expenses', prisma.expenseHeader, 'EXP', 'docDate');
simpleCreate('receipts', prisma.customerReceipt, 'CR', 'receiptDate');
simpleCreate('supplier-payments', prisma.supplierPayment, 'SP', 'paymentDate');
simpleCreate('advances', prisma.advance, 'ADV', 'advanceDate');

app.get('/api/expenses', permit(actionPerms.report), async (_, res) => res.json(await prisma.expenseHeader.findMany()));

app.get('/api/receipts', permit(actionPerms.report), async (_, res) => res.json(await prisma.customerReceipt.findMany()));
app.get('/api/supplier-payments', permit(actionPerms.report), async (_, res) => res.json(await prisma.supplierPayment.findMany()));

app.post('/api/expenses/:id/approve', permit(actionPerms.approve), async (req,res)=>res.json(await statusAction('expenseHeader', Number(req.params.id), 'APPROVE', req.user!.id)));
app.post('/api/expenses/:id/post', permit(actionPerms.post), async (req,res)=>{
  const id=Number(req.params.id); const ex=await prisma.expenseHeader.findUnique({where:{id}}); if(!ex||ex.status!=='APPROVED') return res.status(400).json({message:'غير صالح'});
  const cash=Number((await prisma.systemSetting.findUnique({where:{key:'default_cash_account_id'}}))?.value);
  const sup=Number((await prisma.systemSetting.findUnique({where:{key:'default_supplier_control_account_id'}}))?.value);
  const cat=await prisma.expenseCategory.findUnique({where:{id:ex.categoryId}});
  const je=await postDocument('expense_headers',id,ex.docDate,req.user!.id,`ترحيل مصروف ${ex.docNo}`,[{accountId:cat!.accountId,debitIls:Number(ex.totalAmountIls),creditIls:0},{accountId:ex.paymentType==='CASH'?cash:sup,debitIls:0,creditIls:Number(ex.totalAmountIls)}],ex.paymentType==='CREDIT'?[{subledgerType:'SUPPLIER',referenceId:ex.supplierId!,debitIls:0,creditIls:Number(ex.totalAmountIls)}]:[],ex.paymentType==='CASH'?-Number(ex.totalAmountIls):0);
  await prisma.expenseHeader.update({where:{id},data:{status:'POSTED',postedJournalEntryId:je.id}}); res.json({ok:true});
});
app.post('/api/expenses/:id/cancel', permit(actionPerms.cancel), async (req,res)=>{
  const id=Number(req.params.id); const ex=await prisma.expenseHeader.findUnique({where:{id}});
  if(!ex) return res.status(404).json({message:'غير موجود'});
  if(ex.status==='POSTED'){ const r=await reverseDocument('expense_headers',id,new Date(),req.user!.id,req.body?.reason||'إلغاء رقابي'); await prisma.expenseHeader.update({where:{id},data:{status:'CANCELLED'}}); return res.json({ok:true,reversedJournalEntryId:r.id}); }
  return res.json(await statusAction('expenseHeader', id, 'CANCEL', req.user!.id));
});

app.post('/api/receipts/:id/approve', permit(actionPerms.approve), async (req,res)=>res.json(await statusAction('customerReceipt', Number(req.params.id), 'APPROVE', req.user!.id)));
app.post('/api/receipts/:id/post', permit(actionPerms.post), async (req,res)=>{ const id=Number(req.params.id); const r=await prisma.customerReceipt.findUnique({where:{id}}); if(!r||r.status!=='APPROVED') return res.status(400).json({message:'غير صالح'});
  const cash=Number((await prisma.systemSetting.findUnique({where:{key:'default_cash_account_id'}}))?.value); const cust=Number((await prisma.systemSetting.findUnique({where:{key:'default_customer_control_account_id'}}))?.value);
  const je=await postDocument('customer_receipts',id,r.receiptDate,req.user!.id,`تحصيل ${r.docNo}`,[{accountId:cash,debitIls:Number(r.amountIls),creditIls:0},{accountId:cust,debitIls:0,creditIls:Number(r.amountIls)}],[{subledgerType:'CUSTOMER',referenceId:r.customerId,debitIls:0,creditIls:Number(r.amountIls)}],Number(r.amountIls));
  await prisma.customerReceipt.update({where:{id},data:{status:'POSTED',postedJournalEntryId:je.id}}); res.json({ok:true,journalEntryId:je.id});
});
app.post('/api/receipts/:id/cancel', permit(actionPerms.cancel), async (req,res)=>{
  const id=Number(req.params.id); const r=await prisma.customerReceipt.findUnique({where:{id}}); if(!r) return res.status(404).json({message:'غير موجود'});
  if(r.status==='POSTED'){ const rev=await reverseDocument('customer_receipts',id,new Date(),req.user!.id,req.body?.reason||'إلغاء رقابي'); await prisma.customerReceipt.update({where:{id},data:{status:'CANCELLED'}}); return res.json({ok:true,reversedJournalEntryId:rev.id}); }
  return res.json(await statusAction('customerReceipt', id, 'CANCEL', req.user!.id));
});

app.post('/api/supplier-payments/:id/approve', permit(actionPerms.approve), async (req,res)=>res.json(await statusAction('supplierPayment', Number(req.params.id), 'APPROVE', req.user!.id)));
app.post('/api/supplier-payments/:id/post', permit(actionPerms.post), async (req,res)=>{ const id=Number(req.params.id); const p=await prisma.supplierPayment.findUnique({where:{id}}); if(!p||p.status!=='APPROVED') return res.status(400).json({message:'غير صالح'});
  const cash=Number((await prisma.systemSetting.findUnique({where:{key:'default_cash_account_id'}}))?.value); const sup=Number((await prisma.systemSetting.findUnique({where:{key:'default_supplier_control_account_id'}}))?.value);
  const je=await postDocument('supplier_payments',id,p.paymentDate,req.user!.id,`دفعة مورد ${p.docNo}`,[{accountId:sup,debitIls:Number(p.amountIls),creditIls:0},{accountId:cash,debitIls:0,creditIls:Number(p.amountIls)}],[{subledgerType:'SUPPLIER',referenceId:p.supplierId,debitIls:Number(p.amountIls),creditIls:0}],-Number(p.amountIls));
  await prisma.supplierPayment.update({where:{id},data:{status:'POSTED',postedJournalEntryId:je.id}}); res.json({ok:true,journalEntryId:je.id});
});
app.post('/api/supplier-payments/:id/cancel', permit(actionPerms.cancel), async (req,res)=>{
  const id=Number(req.params.id); const p=await prisma.supplierPayment.findUnique({where:{id}}); if(!p) return res.status(404).json({message:'غير موجود'});
  if(p.status==='POSTED'){ const rev=await reverseDocument('supplier_payments',id,new Date(),req.user!.id,req.body?.reason||'إلغاء رقابي'); await prisma.supplierPayment.update({where:{id},data:{status:'CANCELLED'}}); return res.json({ok:true,reversedJournalEntryId:rev.id}); }
  return res.json(await statusAction('supplierPayment', id, 'CANCEL', req.user!.id));
});

app.get('/api/reports/trial-balance', permit(actionPerms.report), async (req, res) => {
  const from = new Date(String(req.query.from)); const to = new Date(String(req.query.to));
  const rows = await prisma.$queryRawUnsafe(`SELECT a.id,a.code,a."nameAr", COALESCE(SUM(jl."debitIls"),0) debit, COALESCE(SUM(jl."creditIls"),0) credit FROM "Account" a LEFT JOIN "JournalLine" jl ON jl."accountId"=a.id LEFT JOIN "JournalEntry" je ON je.id=jl."journalEntryId" WHERE je."entryDate" BETWEEN $1 AND $2 OR je.id IS NULL GROUP BY a.id ORDER BY a.code`, from, to);
  res.json(rows);
});
app.get('/api/reports/profit-loss', permit(actionPerms.report), async (req,res)=>{
  const from = new Date(String(req.query.from)); const to = new Date(String(req.query.to));
  const data=await prisma.$queryRawUnsafe(`SELECT a.type, COALESCE(SUM(jl."debitIls"),0) debit, COALESCE(SUM(jl."creditIls"),0) credit FROM "JournalLine" jl JOIN "JournalEntry" je ON je.id=jl."journalEntryId" JOIN "Account" a ON a.id=jl."accountId" WHERE je."entryDate" BETWEEN $1 AND $2 AND a.type IN ('REVENUE','EXPENSE') GROUP BY a.type`, from, to);
  res.json(data);
});

app.get('/api/reports/customer-balances', permit(actionPerms.report), async (_,res)=>{
  const data=await prisma.$queryRawUnsafe(`SELECT c.id,c.name, COALESCE(SUM(se."debitIls"-se."creditIls"),0) balance FROM "Customer" c LEFT JOIN "SubledgerEntry" se ON se."referenceId"=c.id AND se."subledgerType"='CUSTOMER' GROUP BY c.id ORDER BY c.id`);
  res.json(data);
});


app.post('/api/journals', permit(actionPerms.create), async (req, res) => {
  const { entryDate, description, lines } = req.body;
  const debit = lines.reduce((a:number,l:any)=>a+Number(l.debitIls||0),0);
  const credit = lines.reduce((a:number,l:any)=>a+Number(l.creditIls||0),0);
  if (debit !== credit) return res.status(400).json({ message: 'القيد غير متوازن' });
  for (const l of lines) if (Number(l.debitIls||0)>0 && Number(l.creditIls||0)>0) return res.status(400).json({ message: 'لا يمكن أن يحتوي السطر على مدين ودائن معًا' });
  const docNo = await nextDocNo('JE', new Date(entryDate));
  const header = await prisma.manualJournal.create({ data: { docNo, entryDate: new Date(entryDate), description } });
  await prisma.manualJournalLine.createMany({ data: lines.map((l:any)=>({ ...l, manualJournalId: header.id })) });
  res.json(header);
});
app.post('/api/journals/:id/approve', permit(actionPerms.approve), async (req,res)=>res.json(await statusAction('manualJournal', Number(req.params.id), 'APPROVE', req.user!.id)));
app.post('/api/journals/:id/post', permit(actionPerms.post), async (req,res)=>{
  const id=Number(req.params.id); const h=await prisma.manualJournal.findUnique({where:{id}}); if(!h||h.status!=='APPROVED') return res.status(400).json({message:'غير صالح'});
  const ls=await prisma.manualJournalLine.findMany({where:{manualJournalId:id}});
  const lines=ls.map((l)=>({accountId:l.accountId,debitIls:Number(l.debitIls),creditIls:Number(l.creditIls),description:l.description||undefined,subledgerType:l.subledgerType||undefined,referenceId:l.referenceId||undefined}));
  const subEntries=ls.filter(l=>l.subledgerType&&l.referenceId).map((l)=>({subledgerType:l.subledgerType!,referenceId:l.referenceId!,debitIls:Number(l.debitIls),creditIls:Number(l.creditIls)}));
  const je=await postDocument('manual_journals',id,h.entryDate,req.user!.id,h.description,lines,subEntries,0);
  await prisma.manualJournal.update({where:{id},data:{status:'POSTED',postedJournalEntryId:je.id}}); res.json({ok:true});
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = err.message === 'PERIOD_CLOSED' ? 'الفترة المالية مغلقة' : err.message;
  res.status(400).json({ message: msg });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.port, () => console.log(`API running on ${env.port}`));
}


export default app;
