import "./globals.css";

export const metadata = {
  title: "Daily Calendar Digest",
  description: "Monthly calendar with Telegram daily digest",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
