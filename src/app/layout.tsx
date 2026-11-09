import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FIELDNOTE — Personal Sports Desk",
  description: "한 경기씩, 근거와 판단을 남기는 개인 스포츠 분석 데스크",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
