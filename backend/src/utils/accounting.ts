import { DocStatus, Prisma, SubledgerType } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../db.js';

type TxClient = Prisma.TransactionClient;

type Line = {
  accountId: number;
  debitIls: number;
  creditIls: number;
  description?: string;
  subledgerType?: SubledgerType;
  referenceId?: number;
};

export async function nextDocNo(documentType: string, date: Date, tx?: TxClient) {
  const fiscalYear = dayjs(date).year();
  const prefix = `${documentType}-${fiscalYear}`;
  const db = tx ?? prisma;
  const seq = await db.documentSequence.upsert({
    where: { documentType_fiscalYear: { documentType, fiscalYear } },
    create: { documentType, fiscalYear, prefix, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } }
  });
  return `${prefix}-${String(seq.lastNumber).padStart(6, '0')}`;
}

export async function ensureOpenPeriod(postingDate: Date) {
  const period = await prisma.fiscalPeriod.findFirst({
    where: { startDate: { lte: postingDate }, endDate: { gte: postingDate } }
  });
  if (!period || period.status !== 'OPEN') throw new Error('PERIOD_CLOSED');
}

export async function postDocument(
  sourceType: string,
  sourceId: number,
  postingDate: Date,
  initiatedBy: number,
  description: string,
  lines: Line[],
  subEntries: { subledgerType: SubledgerType; referenceId: number; debitIls: number; creditIls: number; notes?: string }[] = [],
  cashAmount = 0
) {
  await ensureOpenPeriod(postingDate);
  const totalDebit = lines.reduce((a, b) => a + b.debitIls, 0);
  const totalCredit = lines.reduce((a, b) => a + b.creditIls, 0);
  if (totalDebit !== totalCredit) throw new Error('UNBALANCED_ENTRY');

  const exists = await prisma.journalEntry.findFirst({ where: { sourceType, sourceId } });
  if (exists) throw new Error('ALREADY_POSTED');

  return prisma.$transaction(async (tx) => {
    const entryNo = await nextDocNo('JE', postingDate, tx);
    const je = await tx.journalEntry.create({
      data: {
        entryNo,
        sourceType,
        sourceId,
        entryDate: postingDate,
        description,
        createdBy: initiatedBy,
        lines: { create: lines.map((l) => ({ ...l })) }
      },
      include: { lines: true }
    });

    if (subEntries.length) {
      await tx.subledgerEntry.createMany({
        data: subEntries.map((s) => ({ ...s, entryDate: postingDate, sourceType, sourceId }))
      });
    }

    if (cashAmount) {
      await tx.cashTransaction.create({
        data: {
          txDate: postingDate,
          sourceType,
          sourceId,
          direction: cashAmount > 0 ? 'IN' : 'OUT',
          amountIls: Math.abs(cashAmount)
        }
      });
    }

    await tx.auditLog.create({
      data: { action: 'POST', entityType: sourceType, entityId: sourceId, userId: initiatedBy, newValues: { journalEntryId: je.id } }
    });
    await tx.documentStatusHistory.create({
      data: {
        entityType: sourceType,
        entityId: sourceId,
        previousStatus: DocStatus.APPROVED,
        newStatus: DocStatus.POSTED,
        action: 'POST',
        changedBy: initiatedBy
      }
    });
    return je;
  });
}

export async function reverseDocument(sourceType: string, sourceId: number, reverseDate: Date, initiatedBy: number, reason: string) {
  await ensureOpenPeriod(reverseDate);
  const original = await prisma.journalEntry.findFirst({ where: { sourceType, sourceId }, include: { lines: true } });
  if (!original) throw new Error('NOT_POSTED');
  if (original.reversedEntryId) throw new Error('ALREADY_REVERSED');

  return prisma.$transaction(async (tx) => {
    const entryNo = await nextDocNo('CTX', reverseDate, tx);
    const reversed = await tx.journalEntry.create({
      data: {
        entryNo,
        sourceType: `${sourceType}_REV` ,
        sourceId,
        entryDate: reverseDate,
        description: `عكس قيد: ${original.entryNo} - ${reason}`,
        createdBy: initiatedBy,
        reversedEntryId: original.id,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            description: l.description ?? undefined,
            debitIls: Number(l.creditIls),
            creditIls: Number(l.debitIls),
            subledgerType: l.subledgerType ?? undefined,
            referenceId: l.referenceId ?? undefined
          }))
        }
      }
    });

    await tx.journalEntry.update({ where: { id: original.id }, data: { reversedEntryId: reversed.id } });

    const subRows = await tx.subledgerEntry.findMany({ where: { sourceType, sourceId } });
    if (subRows.length) {
      await tx.subledgerEntry.createMany({
        data: subRows.map((s) => ({
          entryDate: reverseDate,
          subledgerType: s.subledgerType,
          referenceId: s.referenceId,
          sourceType: `${sourceType}_REV`,
          sourceId,
          debitIls: s.creditIls,
          creditIls: s.debitIls,
          notes: `عكس ${reason}`
        }))
      });
    }

    const cashRows = await tx.cashTransaction.findMany({ where: { sourceType, sourceId } });
    for (const c of cashRows) {
      await tx.cashTransaction.create({
        data: {
          txDate: reverseDate,
          sourceType: `${sourceType}_REV`,
          sourceId,
          direction: c.direction === 'IN' ? 'OUT' : 'IN',
          amountIls: c.amountIls,
          notes: `عكس ${reason}`
        }
      });
    }

    await tx.auditLog.create({ data: { action: 'REVERSE', entityType: sourceType, entityId: sourceId, userId: initiatedBy, newValues: { reversedJournalEntryId: reversed.id } } });
    await tx.documentStatusHistory.create({ data: { entityType: sourceType, entityId: sourceId, previousStatus: DocStatus.POSTED, newStatus: DocStatus.CANCELLED, action: 'REVERSE', changedBy: initiatedBy } });
    return reversed;
  });
}
