import "./globals.css";

export const metadata = {
  title: "Календарь",
  description: "Ежедневник с Telegram-рассылкой",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
