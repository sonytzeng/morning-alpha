import type { RouteObject } from "react-router-dom";
import { lazy } from "react";
import Home from "../pages/home/page";
import { Navigate } from "react-router-dom";
import DeferredRoute from "./DeferredRoute";

const NotFound = lazy(() => import("../pages/NotFound"));
const Account = lazy(() => import("../pages/account/Account"));
const AdminLayout = lazy(() => import("../pages/admin/Admin"));
const AdminTodayContent = lazy(() => import("../pages/admin/today-content/page"));
const AdminPublish = lazy(() => import("../pages/admin/scripts/page"));
const AdminSystemStatus = lazy(() => import("../pages/admin/system-check/page"));
const AdminSystemHealth = lazy(() => import("../pages/admin/system-health/page"));
const AdminDataHealth = lazy(() => import("../pages/admin/data-truth/page"));
const AdminLearningCenter = lazy(() => import("../pages/admin/learning/page"));
const ReportsCenter = lazy(() => import("../pages/reports/ReportsCenter"));
const ReportDetail = lazy(() => import("../pages/reports/ReportDetail"));
const TodayReport = lazy(() => import("../pages/report/TodayReport"));
const WarRoom = lazy(() => import("../pages/war-room/WarRoom"));
const Opportunities = lazy(() => import("../pages/opportunities/page"));
const MemberNote = lazy(() => import("../pages/member-note/page"));
const Performance = lazy(() => import("../pages/performance/page"));
const VoicePage = lazy(() => import("../pages/voice/VoicePage"));
const FaqPage = lazy(() => import("../pages/faq/page"));
const TermsPage = lazy(() => import("../pages/terms/page"));
const PrivacyPage = lazy(() => import("../pages/privacy/page"));
const ContactPage = lazy(() => import("../pages/contact/page"));
const Pricing = lazy(() => import("../pages/pricing/Pricing"));
const Verification = lazy(() => import("../pages/verification/page"));
const LoginPage = lazy(() => import("../pages/auth/LoginPage"));
const AuthCallbackPage = lazy(() => import("../pages/auth/AuthCallbackPage"));
const SignalLabPage = lazy(() => import("../pages/signal-lab/page"));

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/report/today",
    element: <DeferredRoute><TodayReport /></DeferredRoute>,
  },
  {
    path: "/opportunities",
    element: <DeferredRoute><Opportunities /></DeferredRoute>,
  },
  {
    path: "/member-note",
    element: <DeferredRoute><MemberNote /></DeferredRoute>,
  },
  {
    path: "/performance",
    element: <DeferredRoute><Performance /></DeferredRoute>,
  },
  {
    path: "/reports",
    element: <DeferredRoute><ReportsCenter /></DeferredRoute>,
  },
  {
    path: "/reports/:reportDate",
    element: <DeferredRoute><ReportDetail /></DeferredRoute>,
  },
  {
    path: "/war-room",
    element: <DeferredRoute><WarRoom /></DeferredRoute>,
  },
  {
    path: "/voice",
    element: <DeferredRoute><VoicePage /></DeferredRoute>,
  },
  {
    path: "/faq",
    element: <DeferredRoute><FaqPage /></DeferredRoute>,
  },
  {
    path: "/terms",
    element: <DeferredRoute><TermsPage /></DeferredRoute>,
  },
  {
    path: "/privacy",
    element: <DeferredRoute><PrivacyPage /></DeferredRoute>,
  },
  {
    path: "/contact",
    element: <DeferredRoute><ContactPage /></DeferredRoute>,
  },
  {
    path: "/pricing",
    element: <DeferredRoute><Pricing /></DeferredRoute>,
  },
  {
    path: "/login",
    element: <DeferredRoute><LoginPage /></DeferredRoute>,
  },
  {
    path: "/auth/callback",
    element: <AuthCallbackPage />,
  },
  {
    path: "/account",
    element: <DeferredRoute><Account /></DeferredRoute>,
  },
  {
    path: "/signal-lab",
    element: <DeferredRoute><SignalLabPage /></DeferredRoute>,
  },
  // V377: Redirect legacy routes
  {
    path: "/dashboard",
    element: <Navigate to="/account" replace />,
  },
  {
    path: "/strategist",
    element: <Navigate to="/account" replace />,
  },
  {
    path: "/admin",
    element: <DeferredRoute><AdminLayout /></DeferredRoute>,
    children: [
      { index: true, element: <Navigate to="/admin/today-content" replace /> },
      { path: "today-content", element: <DeferredRoute><AdminTodayContent /></DeferredRoute> },
      { path: "publish", element: <DeferredRoute><AdminPublish /></DeferredRoute> },
      { path: "system-status", element: <DeferredRoute><AdminSystemStatus /></DeferredRoute> },
      { path: "system-health", element: <DeferredRoute><AdminSystemHealth /></DeferredRoute> },
      { path: "data-health", element: <DeferredRoute><AdminDataHealth /></DeferredRoute> },
      { path: "learning", element: <DeferredRoute><AdminLearningCenter /></DeferredRoute> },
      // V377: Legacy redirects
      { path: "dashboard", element: <Navigate to="/admin/today-content" replace /> },
      { path: "reports", element: <Navigate to="/admin/today-content" replace /> },
      { path: "scripts", element: <Navigate to="/admin/publish" replace /> },
      { path: "system-check", element: <Navigate to="/admin/system-status" replace /> },
      { path: "data-truth", element: <DeferredRoute><AdminDataHealth /></DeferredRoute> },
      { path: "system", element: <Navigate to="/admin/system-status" replace /> },
      { path: "growth", element: <Navigate to="/admin/today-content" replace /> },
      { path: "settings", element: <Navigate to="/admin/system-status" replace /> },
    ],
  },
  // V377: Keep verification page accessible but not in navbar
  {
    path: "/verification",
    element: <DeferredRoute><Verification /></DeferredRoute>,
  },
  {
    path: "*",
    element: <DeferredRoute><NotFound /></DeferredRoute>,
  },
];

export default routes;
