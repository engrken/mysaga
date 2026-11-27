"use client";
import { Fragment, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ChangeEmailForm from "./ChangeEmailForm";
import RealDemoBanner from "./RealDemoBanner";
import AccountMenu, { type AccountTheme } from "./AccountMenu";
import { saveSagaTheme } from "./ThemeSync";
import GradeVisibilityManager from "./GradeVisibilityManager";
import GradeContributionPanel from "./GradeContributionPanel";
import ClassRosterEnrollmentTools from "./ClassRosterEnrollmentTools";
import GoogleChatControls from "./GoogleChatControls";
import { DemoGoogleChatControls } from "./DemoClassChats";
import StudentClassEnrollment from "./StudentClassEnrollment";
// These large interactive tools are only downloaded when opened.
const GradeWhatIfSimulator = dynamic(() => import("./GradeWhatIfSimulator"));
const HelpCenter = dynamic(() => import("./PortalGuides").then(module => module.HelpCenter));
const OnboardingGuide = dynamic(() => import("./PortalGuides").then(module => module.OnboardingGuide));
const PhilippineHolidayCalendar = dynamic(() => import("./PhilippineHolidayCalendar").then(module => module.PhilippineHolidayCalendar));
const TeacherActivities = dynamic(() => import("./ClassActivities").then(module => module.TeacherActivities));
const RecentActivitySubmissions = dynamic(() => import¶»§q«^