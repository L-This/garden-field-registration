import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'تسجيل ري الحدائق',
  description: 'نظام ميداني لتسجيل ري الحدائق ورفع إثباتات العمل',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>

  <script
    dangerouslySetInnerHTML={{
      __html: `
        (function () {
          const KEY = "contractor_app_build_version";

          async function checkVersion() {
            try {
              const res = await fetch('/api/version', { cache: 'no-store' });
              const data = await res.json();
              const current = localStorage.getItem(KEY);

              if (current && current !== data.version) {
                localStorage.setItem(KEY, data.version);
                window.location.reload();
                return;
              }

              if (!current) {
                localStorage.setItem(KEY, data.version);
              }
            } catch (e) {}
          }

          checkVersion();
        })();
      `,
    }}
  />

  {children}

</body>
    </html>
  );
}
