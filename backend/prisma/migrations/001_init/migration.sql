-- PostgreSQL initial schema
CREATE TYPE "RoleCode" AS ENUM ('ADMIN','FINANCE_MANAGER','ACCOUNTANT','DATA_ENTRY');
CREATE TYPE "DocStatus" AS ENUM ('DRAFT','APPROVED','POSTED','CANCELLED');
CREATE TYPE "PaymentType" AS ENUM ('CASH','CREDIT');
CREATE TYPE "FiscalStatus" AS ENUM ('OPEN','CLOSED');
CREATE TYPE "SubledgerType" AS ENUM ('CUSTOMER','SUPPLIER','ADVANCE');
CREATE TYPE "BeneficiaryType" AS ENUM ('EMPLOYEE','CUSTOMER','SUPPLIER','OTHER');
CREATE TYPE "SettlementType" AS ENUM ('EXPENSE','CASH_RETURN','OTHER');

CREATE TABLE "Role" ("id" SERIAL PRIMARY KEY, "code" "RoleCode" UNIQUE NOT NULL, "name" TEXT NOT NULL);
CREATE TABLE "Permission" ("id" SERIAL PRIMARY KEY, "code" TEXT UNIQUE NOT NULL, "description" TEXT NOT NULL);
CREATE TABLE "RolePermission" ("roleId" INT NOT NULL, "permissionId" INT NOT NULL, PRIMARY KEY("roleId","permissionId"));
CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "username" TEXT UNIQUE NOT NULL, "fullName" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "roleId" INT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true);

CREATE TABLE "Account" ("id" SERIAL PRIMARY KEY, "code" TEXT UNIQUE NOT NULL, "nameAr" TEXT NOT NULL, "type" TEXT NOT NULL, "isControl" BOOLEAN NOT NULL DEFAULT false, "controlSubledgerType" "SubledgerType", "isPostable" BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE "RevenueCategory" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "accountId" INT NOT NULL);
CREATE TABLE "ExpenseCategory" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "accountId" INT NOT NULL);
CREATE TABLE "Customer" ("id" SERIAL PRIMARY KEY, "code" TEXT UNIQUE NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "address" TEXT, "openingBalanceIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE "Supplier" ("id" SERIAL PRIMARY KEY, "code" TEXT UNIQUE NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "address" TEXT, "openingBalanceIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true);

CREATE TABLE "RevenueHeader" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "docDate" TIMESTAMP NOT NULL, "customerId" INT, "categoryId" INT NOT NULL, "paymentType" "PaymentType" NOT NULL, "totalAmountIls" DECIMAL(14,2) NOT NULL, "notes" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);
CREATE TABLE "ExpenseHeader" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "docDate" TIMESTAMP NOT NULL, "supplierId" INT, "categoryId" INT NOT NULL, "paymentType" "PaymentType" NOT NULL, "totalAmountIls" DECIMAL(14,2) NOT NULL, "notes" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);
CREATE TABLE "CustomerReceipt" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "receiptDate" TIMESTAMP NOT NULL, "customerId" INT NOT NULL, "amountIls" DECIMAL(14,2) NOT NULL, "notes" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);
CREATE TABLE "SupplierPayment" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "paymentDate" TIMESTAMP NOT NULL, "supplierId" INT NOT NULL, "amountIls" DECIMAL(14,2) NOT NULL, "notes" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);
CREATE TABLE "Advance" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "advanceDate" TIMESTAMP NOT NULL, "beneficiaryType" "BeneficiaryType" NOT NULL, "beneficiaryName" TEXT NOT NULL, "amountIls" DECIMAL(14,2) NOT NULL, "settledAmountIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "notes" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);
CREATE TABLE "AdvanceSettlement" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "advanceId" INT NOT NULL, "settlementDate" TIMESTAMP NOT NULL, "settlementType" "SettlementType" NOT NULL, "amountIls" DECIMAL(14,2) NOT NULL, "expenseCategoryId" INT, "notes" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);

CREATE TABLE "JournalEntry" ("id" SERIAL PRIMARY KEY, "entryNo" TEXT UNIQUE NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" INT NOT NULL, "entryDate" TIMESTAMP NOT NULL, "description" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'POSTED', "reversedEntryId" INT, "createdBy" INT NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now());
CREATE TABLE "JournalLine" ("id" SERIAL PRIMARY KEY, "journalEntryId" INT NOT NULL, "accountId" INT NOT NULL, "description" TEXT, "debitIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "creditIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "subledgerType" "SubledgerType", "referenceId" INT);
CREATE TABLE "SubledgerEntry" ("id" SERIAL PRIMARY KEY, "entryDate" TIMESTAMP NOT NULL, "subledgerType" "SubledgerType" NOT NULL, "referenceId" INT NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" INT NOT NULL, "debitIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "creditIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "notes" TEXT);
CREATE TABLE "CashTransaction" ("id" SERIAL PRIMARY KEY, "txDate" TIMESTAMP NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" INT NOT NULL, "direction" TEXT NOT NULL, "amountIls" DECIMAL(14,2) NOT NULL, "notes" TEXT);
CREATE TABLE "DocumentSequence" ("id" SERIAL PRIMARY KEY, "documentType" TEXT NOT NULL, "fiscalYear" INT NOT NULL, "prefix" TEXT NOT NULL, "lastNumber" INT NOT NULL DEFAULT 0, UNIQUE("documentType","fiscalYear"));
CREATE TABLE "FiscalPeriod" ("id" SERIAL PRIMARY KEY, "name" TEXT UNIQUE NOT NULL, "startDate" TIMESTAMP NOT NULL, "endDate" TIMESTAMP NOT NULL, "status" "FiscalStatus" NOT NULL);
CREATE TABLE "SystemSetting" ("id" SERIAL PRIMARY KEY, "key" TEXT UNIQUE NOT NULL, "value" TEXT NOT NULL);
CREATE TABLE "AuditLog" ("id" SERIAL PRIMARY KEY, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" INT NOT NULL, "oldValues" JSONB, "newValues" JSONB, "userId" INT NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now());
CREATE TABLE "DocumentStatusHistory" ("id" SERIAL PRIMARY KEY, "entityType" TEXT NOT NULL, "entityId" INT NOT NULL, "previousStatus" TEXT, "newStatus" TEXT NOT NULL, "action" TEXT NOT NULL, "changedBy" INT NOT NULL, "changedAt" TIMESTAMP NOT NULL DEFAULT now());
CREATE TABLE "ManualJournal" ("id" SERIAL PRIMARY KEY, "docNo" TEXT UNIQUE NOT NULL, "entryDate" TIMESTAMP NOT NULL, "description" TEXT NOT NULL, "status" "DocStatus" NOT NULL DEFAULT 'DRAFT', "postedJournalEntryId" INT);
CREATE TABLE "ManualJournalLine" ("id" SERIAL PRIMARY KEY, "manualJournalId" INT NOT NULL, "accountId" INT NOT NULL, "description" TEXT, "debitIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "creditIls" DECIMAL(14,2) NOT NULL DEFAULT 0, "subledgerType" "SubledgerType", "referenceId" INT);

ALTER TABLE "RolePermission" ADD FOREIGN KEY ("roleId") REFERENCES "Role"("id");
ALTER TABLE "RolePermission" ADD FOREIGN KEY ("permissionId") REFERENCES "Permission"("id");
ALTER TABLE "User" ADD FOREIGN KEY ("roleId") REFERENCES "Role"("id");
ALTER TABLE "AuditLog" ADD FOREIGN KEY ("userId") REFERENCES "User"("id");
ALTER TABLE "JournalLine" ADD FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id");
ALTER TABLE "ManualJournalLine" ADD FOREIGN KEY ("manualJournalId") REFERENCES "ManualJournal"("id");
