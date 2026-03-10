import './styles.css';
import Link from 'next/link';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="container">
          <aside>
            <h3>النظام المحاسبي ILS</h3>
            {['dashboard','revenues','expenses','customers','suppliers','advances','receipts','supplier-payments','journals','reports'].map((p)=> <Link key={p} href={`/${p}`}>{p}</Link>)}
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
