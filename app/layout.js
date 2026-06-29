import "./globals.css";

export const metadata = {
  title: "Орбита дел",
  description: "Семейный календарь с Telegram-рассылкой",
  applicationName: "Орбита дел",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Орбита дел",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/orbita-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/orbita-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  themeColor: "#23314c",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
