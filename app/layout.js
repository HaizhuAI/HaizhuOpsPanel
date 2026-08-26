import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "HaizhuOpsPanel — 企业级可视化运维与 AI 应用部署平台",
  description: "统一管理主机、站点、数据库、容器、任务、备份、安全审计与 AI 应用部署，让企业运维清晰可控。",
  keywords: ["服务器运维", "独立开发者", "SaaS", "Docker", "可视化运维"],
  openGraph: {
    title: "HaizhuOpsPanel — 企业级可视化运维工作台",
    description: "一块面板，统一掌握所有基础设施与 AI 服务。",
    type: "website",
    locale: "zh_CN"
  }
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#07110f" };

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={`${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
