import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import Home from "../pages/home/page";
import TodayReport from "../pages/report/TodayReport";
import Account from "../pages/account/Account";
import AdminLayout from "../pages/admin/Admin";
import AdminTodayContent from "../pages/admin/today-content/page";
import AdminPublish from "../pages/admin/scripts/page";
import AdminSystemStatus from "../pages/admin/system-check/page";
import AdminSystemHealth from "../pages/admin/system-health/page";
import AdminDataHealth from "../pages/admin/data-truth/page";
import ReportsCenter from "../pages/reports/ReportsCenter";
import ReportDetail from "../pages/reports/ReportDetail";
import WarRoom from "../pages/war-room/WarRoom";
import Opportunities from "../pages/opportunities/page";
import MemberNote from "../pages/member-note/page";
import VoicePage from "../pages/voice/VoicePage";
import FaqPage from "../pages/faq/page";
import TermsPage from "../pages/terms/page";
import PrivacyPage from "../pages/privacy/page";
import ContactPage from "../pages/contact/page";
import { Navigate } from "react-router-dom";
import Verification from "../pages/verification/page";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/report/today",
    element: <TodayReport />,
  },
  {
    path: "/opportunities",
    element: <Opportunities />,
  },
  {
    path: "/member-note",
    element: <MemberNote />,
  },
  {
    path: "/reports",
    element: <ReportsCenter />,
  },
  {
    path: "/reports/:reportDate",
    element: <ReportDetail />,
  },
  {
    path: "/war-room",
    element: <WarRoom />,
  },
  {
    path: "/voice",
    element: <VoicePage />,
  },
  {
    path: "/faq",
    element: <FaqPage />,
  },
  {
    path: "/terms",
    element: <TermsPage />,
  },
  {
    path: "/privacy",
    element: <PrivacyPage />,
  },
  {
    path: "/contact",
    element: <ContactPage />,
  },
  {
    path: "/account",
    element: <Account />,
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
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/admin/today-content" replace /> },
      { path: "today-content", element: <AdminTodayContent /> },
      { path: "publish", element: <AdminPublish /> },
      { path: "system-status", element: <AdminSystemStatus /> },
      { path: "system-health", element: <AdminSystemHealth /> },
      { path: "data-health", element: <AdminDataHealth /> },
      // V377: Legacy redirects
      { path: "dashboard", element: <Navigate to="/admin/today-content" replace /> },
      { path: "reports", element: <Navigate to="/admin/today-content" replace /> },
      { path: "scripts", element: <Navigate to="/admin/publish" replace /> },
      { path: "system-check", element: <Navigate to="/admin/system-status" replace /> },
      { path: "data-truth", element: <AdminDataHealth /> },
      { path: "system", element: <Navigate to="/admin/system-status" replace /> },
      { path: "growth", element: <Navigate to="/admin/today-content" replace /> },
      { path: "settings", element: <Navigate to="/admin/system-status" replace /> },
    ],
  },
  // V377: Keep verification page accessible but not in navbar
  {
    path: "/verification",
    element: <Verification />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;
