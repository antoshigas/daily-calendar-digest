import "./globals.css";

export const metadata = {
  title: "Орбіта справ",
  description: "Особистий календар із Telegram-розсилкою",
  applicationName: "Орбіта справ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Орбіта справ",
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
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
