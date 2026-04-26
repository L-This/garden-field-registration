import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'تسجيل ري الحدائق',
  description: 'نظام ميداني لتسجيل ري الحدائق ورفع إثباتات العمل',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
