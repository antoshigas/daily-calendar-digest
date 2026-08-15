export default function manifest() {
  return {
    name: "Орбіта справ",
    short_name: "Орбіта справ",
    description: "Особистий календар із Telegram-зведенням",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#23314c",
    theme_color: "#23314c",
    icons: [
      {
        src: "/icons/orbita-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/orbita-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/orbita-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
