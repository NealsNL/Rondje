import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "../components/RegisterSW";

export const metadata: Metadata = {
  title: "Rondje",
  description: "Fietsroutes tekenen, genereren en exporteren voor Garmin",
  applicationName: "Rondje",
  appleWebApp: { capable: true, title: "Rondje", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
