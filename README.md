# نظام محاسبي عربي RTL (ILS)

تطبيق Full-Stack للشركات الصغيرة موجّه للاستخدام الداخلي المنضبط رقابيًا.

## التقنية
- **Frontend**: Next.js (واجهة عربية RTL)
- **Backend**: Node.js + Express + Prisma
- **Database**: PostgreSQL
- **Auth**: JWT داخل `httpOnly` Cookie

## التشغيل
1. تثبيت الحزم:
```bash
npm install
```
2. إعداد البيئة:
```bash
cp backend/.env.example backend/.env
```
3. إنشاء قاعدة البيانات وتشغيل Prisma:
```bash
npm --workspace backend run prisma:generate
npm --workspace backend run prisma:migrate -- --name init
npm --workspace backend run seed
```
4. تشغيل الواجهة والخادم:
```bash
npm run dev
```

## بيانات الدخول التجريبية
- `admin / Admin123!`
- `accountant / Account123!`
- `entry / Entry123!`
- `finance / Finance123!`

## الوحدات المنفذة
- المصادقة والصلاحيات (Backend-enforced).
- الإيرادات / المصروفات / التحصيلات / مدفوعات الموردين.
- العملاء / الموردون / كشف حساب (Subledger).
- القيود اليدوية (create/approve/post).
- ترحيل محاسبي موحّد + عكس قيد عند الإلغاء الرقابي للمستندات المرحلة.
- التقارير: Trial Balance, Profit & Loss, Customer Balances.
- سجل تدقيق Audit Log + سجل تاريخ الحالة Document Status History.

## ملاحظات
- العملة الوحيدة المعتمدة: **ILS**.
- لا يوجد دعم تعدد العملات في هذه المرحلة.
- لا يتم الترحيل إلا داخل فترة مالية مفتوحة (`PERIOD_CLOSED` عند الإغلاق).
