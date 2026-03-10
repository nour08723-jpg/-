import { PrismaClient, RoleCode } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const perms = ['DOC_CREATE','DOC_UPDATE','DOC_APPROVE','DOC_POST','DOC_CANCEL','DOC_REVERSE','REPORT_VIEW'];
  for (const p of perms) await prisma.permission.upsert({ where: { code: p }, update: {}, create: { code: p, description: p } });

  const rolePermMap: Record<RoleCode, string[]> = {
    ADMIN: perms,
    FINANCE_MANAGER: ['DOC_CREATE','DOC_UPDATE','DOC_APPROVE','DOC_POST','DOC_CANCEL','DOC_REVERSE','REPORT_VIEW'],
    ACCOUNTANT: ['DOC_CREATE','DOC_UPDATE','DOC_APPROVE','DOC_POST','REPORT_VIEW'],
    DATA_ENTRY: ['DOC_CREATE','DOC_UPDATE']
  };

  for (const code of Object.values(RoleCode)) {
    const role = await prisma.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
    for (const p of rolePermMap[code]) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: p } });
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, update: {}, create: { roleId: role.id, permissionId: perm.id } });
    }
  }

  const pass = async (s: string) => bcrypt.hash(s, 10);
  const users = [
    ['admin', 'Admin123!', 'ADMIN'],
    ['accountant', 'Account123!', 'ACCOUNTANT'],
    ['entry', 'Entry123!', 'DATA_ENTRY'],
    ['finance', 'Finance123!', 'FINANCE_MANAGER']
  ] as const;

  for (const [username, password, roleCode] of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode as RoleCode } });
    await prisma.user.upsert({ where: { username }, update: {}, create: { username, fullName: username, passwordHash: await pass(password), roleId: role.id } });
  }

  const accounts = [
    ['1001','الصندوق','ASSET',false,null],['1101','العملاء','ASSET',true,'CUSTOMER'],['1102','السلف','ASSET',true,'ADVANCE'],['2101','الموردون','LIABILITY',true,'SUPPLIER'],['3001','رأس المال','EQUITY',false,null],['4001','إيرادات تشغيلية','REVENUE',false,null],['5001','مصروفات تشغيلية','EXPENSE',false,null]
  ] as const;
  for (const [code,nameAr,type,isControl,controlSubledgerType] of accounts) {
    await prisma.account.upsert({ where: { code }, update: {}, create: { code, nameAr, type, isControl, controlSubledgerType: controlSubledgerType as any } });
  }

  const revAcc = await prisma.account.findUniqueOrThrow({ where: { code: '4001' } });
  const expAcc = await prisma.account.findUniqueOrThrow({ where: { code: '5001' } });
  await prisma.revenueCategory.upsert({ where: { id: 1 }, update: {}, create: { name: 'خدمات', accountId: revAcc.id } });
  await prisma.expenseCategory.upsert({ where: { id: 1 }, update: {}, create: { name: 'تشغيل', accountId: expAcc.id } });
  await prisma.customer.upsert({ where: { code: 'C001' }, update: {}, create: { code: 'C001', name: 'عميل تجريبي' } });
  await prisma.supplier.upsert({ where: { code: 'S001' }, update: {}, create: { code: 'S001', name: 'مورد تجريبي' } });

  const cash = await prisma.account.findUniqueOrThrow({ where: { code: '1001' } });
  const cust = await prisma.account.findUniqueOrThrow({ where: { code: '1101' } });
  const sup = await prisma.account.findUniqueOrThrow({ where: { code: '2101' } });
  await prisma.systemSetting.upsert({ where: { key: 'default_cash_account_id' }, update: { value: String(cash.id) }, create: { key: 'default_cash_account_id', value: String(cash.id) } });
  await prisma.systemSetting.upsert({ where: { key: 'default_customer_control_account_id' }, update: { value: String(cust.id) }, create: { key: 'default_customer_control_account_id', value: String(cust.id) } });
  await prisma.systemSetting.upsert({ where: { key: 'default_supplier_control_account_id' }, update: { value: String(sup.id) }, create: { key: 'default_supplier_control_account_id', value: String(sup.id) } });

  await prisma.fiscalPeriod.upsert({ where: { name: '2026-03' }, update: {}, create: { name: '2026-03', startDate: new Date('2026-03-01'), endDate: new Date('2026-03-31'), status: 'OPEN' } });
  await prisma.fiscalPeriod.upsert({ where: { name: '2026-02' }, update: {}, create: { name: '2026-02', startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28'), status: 'CLOSED' } });
}
main().finally(()=>prisma.$disconnect());
