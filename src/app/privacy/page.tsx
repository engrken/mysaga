import Link from "next/link";
import { prisma } from "@/lib/prisma";

type PrivacyPageProps = {
  searchParams: Promise<{ schoolId?: string }>;
};

export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const { schoolId } = await searchParams;
  const school = schoolId
    ? await prisma.school.findFirst({
        where: { id: schoolId, isActive: true },
        select: {
          name: true,
          privacyController: true,
          privacyContactEmail: true,
          privacyPolicyUrl: true
        }
      })
    : null;

  const platformPrivacyEmail = process.env.SAGA_PRIVACY_CONTACT_EMAIL?.trim() || "";
  const schoolName = school?.name || "the school that provides your SAGA Portal access";
  const schoolContact = school?.privacyContactEmail?.trim() || "";
  const platformContact = platformPrivacyEmail;

  return (
    <main className="privacy-page">
      <article className="privacy-document">
        <Link href="/" className="privacy-back">← Back to SAGA Portal</Link>
        <p className="eyebrow text-primary mt-4">SAGA PORTAL · PRIVACY</p>
        <h1>Privacy Notice</h1>
        <p className="privacy-updated">
          Effective November 27, 2026 · Version 2.0
          {school ? ` · ${school.name} workspace` : ""}
        </p>

        <p>
          SAGA Portal (School Assessment, Grading &amp; Analytics) provides tools for
          schools and teachers to manage classes, attendance, assessments, learning
          activities, grades, and student access to academic information. This notice
          explains what information the service handles, why it is used, how it may
          be shared, and how privacy requests can be made.
        </p>

        <div className="alert alert-warning small" role="note">
          <strong>School responsibility.</strong> SAGA Portal is an independently
          operated service and is not an official system of a school unless that
          school has separately authorized or adopted it. A participating school
          determines the educational purposes for its workspace and remains
          responsible for giving students and other affected people the notices and
          instructions required for its use. Do not enter real student information
          unless your school has approved the use of the service.
        </div>

        <h2>1. Who is responsible for the information?</h2>
        <p>
          For student directories, class rosters, attendance, assessment results,
          submissions, and other school records, the participating school normally
          decides why those records are collected and how they are used. The school is
          therefore the primary contact for requests about those records. SAGA Portal
          provides the hosted software and processes school records to operate the
          service in accordance with the school's configuration and instructions.
        </p>
        <p>
          SAGA Portal's operator may separately handle account, service, and security
          information to create accounts, maintain the platform, prevent misuse, and
          provide support. The exact responsibilities of the school and the service
          operator depend on the school's adoption and service arrangements.
        </p>
        <p>
          {school ? (
            <>
              <strong>Workspace:</strong> {school.name}.{" "}
              <strong>School privacy contact/controller:</strong>{" "}
              {school.privacyController || "Not specified by the school"}.
              {school.privacyPolicyUrl && (
                <>
                  {" "}Read the school's{" "}
                  <a href={school.privacyPolicyUrl} target="_blank" rel="noreferrer">
                    privacy policy
                  </a>.
                </>
              )}
            </>
          ) : (
            <>
              This is the general SAGA Portal notice. The school-specific controller,
              privacy contact, and school policy may be shown when a workspace-specific
              privacy link is provided.
            </>
          )}
        </p>

        <h2>2. Information the service may process</h2>
        <ul>
          <li>
            <strong>Account and identity details:</strong> name, email address,
            student number or faculty ID, role, school/workspace, course or program,
            year level, section, position, profile image, account status, and
            verification information.
          </li>
          <li>
            <strong>Class and academic records:</strong> subject and class details,
            enrollment, rosters, attendance-related entries, assessment definitions,
            scores, remarks, grade calculations, final grades, grade changes,
            publication and submission status, and related audit history.
          </li>
          <li>
            <strong>Activities and submissions:</strong> quiz answers and attempts,
            assignment text, uploaded file names and metadata, resource links,
            submitted work, teacher feedback, marks, and timestamps.
          </li>
          <li>
            <strong>Account communications:</strong> email verification codes,
            invitations, password-reset and email-change requests, and service or
            billing notifications. Authentication codes and reset tokens are handled
            for the limited purpose of verifying or securing an account.
          </li>
          <li>
            <strong>Security and technical information:</strong> session and
            authentication data, relevant request and rate-limit information, audit
            events, timestamps, and error or diagnostic details needed to protect
            and maintain the service.
          </li>
          <li>
            <strong>Google sign-in and connected services:</strong> if you choose
            Google as your SAGA sign-in method, the service processes your verified
            Google account identifier and email. Teachers may also authorize the
            limited Google Drive and Google Chat permissions needed for class tools;
            service tokens are encrypted and are not used as SAGA passwords.
          </li>
        </ul>

        <h2>3. Why the information is used</h2>
        <p>The service uses information only as needed to provide and protect its functions, including to:</p>
        <ul>
          <li>create and verify teacher and student accounts, authenticate users, and manage access;</li>
          <li>match students to the correct school directory, class, and enrollment;</li>
          <li>record attendance, assessments, submissions, scores, grade calculations, and teacher feedback;</li>
          <li>show students the class content and results that their school or teacher makes available to them;</li>
          <li>send verification, invitation, account-recovery, and necessary service emails;</li>
          <li>operate optional class integrations requested by a teacher, including Google Chat;</li>
          <li>maintain system security, investigate suspected misuse, troubleshoot errors, and keep appropriate audit records; and</li>
          <li>meet applicable legal, regulatory, school-record, and service-administration requirements.</li>
        </ul>
        <p>
          The school is responsible for determining and documenting the lawful basis
          for its use of student and academic information under applicable law. A
          school should not treat a student's use of the portal as blanket consent
          for unrelated processing.
        </p>

        <h2>4. Google sign-in, Drive, and Google Chat</h2>
        <p>
          Google Sign-In is an alternative way to authenticate to SAGA Portal. When
          you choose it, Google verifies your identity and SAGA matches the verified
          Google email to an existing account in the school you selected. SAGA does
          not receive your Google password. Google sign-in does not create a new
          school account or grant access to another school; your existing SAGA role,
          school membership, and class permissions continue to control what you can
          see and do.
        </p>
        <p>
          Students use Google sign-in to establish their SAGA identity. Their verified
          email is used for class identity and Google Chat membership invitations.
          Students do not receive teacher-only permissions to create class Chat spaces,
          manage memberships, or send messages through SAGA.
        </p>
        <p>
          For teachers, the first Google sign-in automatically continues to a Google
          authorization screen for the additional services when the permissions have
          not already been granted. These permissions include the limited
          <code>drive.file</code> scope for files selected through Google Picker and
          the Google Chat scopes needed to list or create spaces, manage class
          memberships, and send class messages. This is a separate Google consent
          step after identity sign-in because SAGA must request only the permissions
          needed for those services. If a teacher declines it, SAGA sign-in still
          succeeds, but Drive Picker and Chat management remain unavailable until
          the services are authorized.
        </p>
        <p>
          SAGA does not request broad access to all files in Google Drive or Gmail
          mailbox access. Teachers select the specific Drive files to use as Activity
          materials. SAGA stores the selected Drive link and encrypted Google service
          tokens; it does not copy the Drive file contents or change file-sharing
          permissions. Teachers must give enrolled students the appropriate viewing
          access in Google Drive. Students opening a Drive link must use the Google
          account that has been granted access to that file.
        </p>
        <p>
          Google access and refresh tokens are encrypted at rest and used only for
          the connected SAGA Drive and Chat features. A teacher can reconnect the
          service from the class Chat controls or revoke the application's access
          through Google Account settings. Google then processes account and Chat
          activity under Google's own terms and privacy information.
        </p>

        <h2>5. Assignments, uploaded files, and Google Drive links</h2>
        <p>
          For assignment submissions, files up to 5 MB per file may be uploaded
          directly to the service's private Cloudflare R2 object storage. The
          service stores file details such as the name, size, type, storage reference,
          and submission relationship. The new submission flow does not return
          public object URLs. When a student or teacher downloads an attachment,
          SAGA verifies the user's sign-in, school, and submission ownership or
          assigned-class access, then redirects to a short-lived download URL. The
          temporary download URL expires after approximately three minutes. Do not
          share a temporary download URL with anyone else. Previously issued public
          R2 links may remain accessible under the bucket's existing settings until
          the operator disables public R2 access after the authenticated download
          flow has been deployed and verified.
        </p>
        <p>
          For larger files, a student may provide a Google Drive share link instead
          of uploading the file to SAGA Portal. In that case, the file remains in
          Google Drive and SAGA Portal stores the supplied link and related submission
          details. Access to the file is controlled by the sharing permissions set
          in Google Drive. Students and teachers should check that the intended
          recipient has the correct access and that the link is not broader than
          necessary.
        </p>

        <h2>6. Who may receive or access information</h2>
        <ul>
          <li>
            <strong>Authorized school users:</strong> teachers and school
            administrators may access records needed for their approved duties and
            within their assigned school workspace.
          </li>
          <li>
            <strong>Students:</strong> students may access their own account and
            the class information or results made available to their account.
          </li>
          <li>
            <strong>Service providers:</strong> infrastructure and communications
            providers may process information on behalf of the service to host the
            application, maintain the database, store submitted files, or deliver
            transactional emails.
          </li>
          <li>
            <strong>Connected services:</strong> Google receives information required
            for a teacher-authorized Google Chat integration. Google Drive receives
            files that users independently choose to upload there and controls access
            to those files through its own sharing settings.
          </li>
          <li>
            <strong>Legal and safety disclosures:</strong> information may be
            disclosed when required by law, valid legal process, or when reasonably
            necessary to protect users, school records, or the security of the service.
          </li>
        </ul>
        <p>
          The service's current technical providers may include Vercel for application
          hosting, Neon for the PostgreSQL database, Cloudflare R2 for private
          assignment file storage, the SMTP provider configured by the operator for
          email delivery, Google for the optional Google integrations, and Cognix
          for limited operational health-event reporting. Provider services and
          configurations may change as the platform evolves.
        </p>
        <p>
          When SAGA's database readiness check fails, SAGA may send Cognix a fixed
          technical event containing a generated event identifier, timestamp,
          application name, fixed database-unavailable category and severity,
          component and operation codes, HTTP status, dependency code, and deployment
          environment. This report does not include user or tenant identity, student
          or teacher information, request contents, SQL, database error text, grades,
          submissions, or other academic records. The report is best-effort and does
          not change the health response shown by SAGA.
        </p>
        <p>
          SAGA Portal is not designed to sell personal information or use student
          education records for targeted advertising.
        </p>

        <h2>7. Storage location and international processing</h2>
        <p>
          The application, database, email, file-storage, and optional integration
          providers may operate infrastructure in different locations. Depending on
          provider configuration and service routing, information may be processed
          or stored outside the Philippines. The school and service operator should
          review provider settings and applicable cross-border transfer safeguards
          before using the service for real student records.
        </p>

        <h2>8. How long information is kept</h2>
        <p>
          SAGA Portal does not apply one universal retention period to every school
          record. The school should set retention and disposal rules based on its
          educational purpose, records policies, and legal obligations. Records may
          remain while the school workspace and account are active or while they are
          needed for class administration, grade verification, security, dispute
          handling, or legal compliance.
        </p>
        <p>
          When a school authorizes deletion, the operator will handle eligible
          application data in accordance with the service arrangement and applicable
          requirements. Backups, security logs, provider-held copies, and records
          subject to a legal or school retention requirement may not disappear
          immediately. Google Drive files are managed in Google Drive by the file
          owner or organization and are not deleted simply by removing a link from
          SAGA Portal.
        </p>

        <h2>9. Cookies and session security</h2>
        <p>
          SAGA Portal uses an essential session cookie to keep a user signed in and
          enforce account permissions. The session cookie is configured as
          HttpOnly, uses Secure in production, and uses the SameSite=Lax setting.
          The service may also use strictly necessary technical mechanisms for
          security and application operation. Blocking cookies in the browser may
          prevent sign-in or other authenticated features from working.
        </p>
        <p>
          Security measures include password hashing, signed session tokens,
          role-based access checks, school-scoped record access, authentication
          throttling, and encryption of stored Google OAuth tokens. These safeguards
          reduce risk but cannot guarantee that the service or any internet
          transmission is completely secure.
        </p>

        <h2>10. Automated calculations and important decisions</h2>
        <p>
          SAGA Portal can calculate scores and grades using settings entered by
          authorized teachers. These calculations are administrative aids and may
          contain errors if source data or settings are incorrect. Teachers and the
          school must review important results and follow the school's official
          grading and Registrar procedures. The portal does not replace the school's
          authority to determine and correct official academic records.
        </p>

        <h2>11. Your privacy rights and how to make a request</h2>
        <p>
          Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173),
          individuals may have rights to be informed, access their personal
          information, dispute or correct inaccurate information, object to certain
          processing, request blocking or erasure where legally available, seek
          damages where applicable, and lodge a complaint with the National Privacy
          Commission. These rights are subject to the conditions and limitations
          provided by law.
        </p>
        <p>
          For student records, class information, grades, attendance, or school
          account details, send your request first to the school or its designated
          Data Protection Officer/privacy contact. A parent or authorized
          representative may contact the school where appropriate. Include enough
          information for the school to locate the record, but do not send passwords,
          one-time codes, or unnecessary sensitive information.
        </p>
        <p>
          For information handled directly by the SAGA Portal operator, use the
          platform privacy contact below. The operator may coordinate with the
          relevant school where the request concerns records controlled by that
          school. The service may need to verify the requester's identity and
          authority before taking action.
        </p>

        <h2>12. Children and student information</h2>
        <p>
          The service may contain education records relating to students who are
          minors. Schools and authorized teachers must use the service only for
          approved educational purposes, follow applicable school safeguarding and
          privacy procedures, and obtain any notice, authority, or consent required
          by law and school policy. Students should use the service only through the
          account and access process provided by their school.
        </p>

        <h2>13. Changes to this notice</h2>
        <p>
          This notice may be revised when the service, integrations, providers, or
          applicable requirements change. The effective date and version above
          identify the current notice. Material changes should be communicated
          through the portal or by the participating school where appropriate.
        </p>

        <h2>14. Privacy contacts</h2>
        {schoolContact ? (
          <p>
            <strong>{school?.privacyController || schoolName}:</strong>{" "}
            <a href={`mailto:${schoolContact}`}>{schoolContact}</a>
          </p>
        ) : (
          <p>
            <strong>School records:</strong> Contact the school administrator or
            the school's designated Data Protection Officer/privacy contact.{" "}
            {school ? "The school has not configured a privacy contact email for this workspace." : ""}
          </p>
        )}
        {platformContact ? (
          <p>
            <strong>SAGA Portal service privacy contact:</strong>{" "}
            <a href={`mailto:${platformContact}`}>{platformContact}</a>
          </p>
        ) : (
          <p>
            <strong>SAGA Portal service privacy contact:</strong> The operator's
            direct privacy email has not yet been configured for publication.
            Please use the official contact channel through which your school or
            organization provided access to the service.
          </p>
        )}
        <p>
          You may also learn about your rights or the complaint process through the{" "}
          <a href="https://privacy.gov.ph/data-subject-rights/" target="_blank" rel="noreferrer">
            National Privacy Commission's data subject rights guidance
          </a>{" "}
          and its{" "}
          <a href="https://privacy.gov.ph/filing-a-complaint/" target="_blank" rel="noreferrer">
            complaint procedure
          </a>.
        </p>

        <div className="privacy-footer">
          This notice describes the SAGA Portal service based on its current
          features and configured providers. It is intended to help users understand
          the service; it is not legal advice, a school-specific privacy impact
          assessment, or a certification of compliance. Each participating school
          should review this notice, publish its own controller and contact details,
          and confirm that its use of the service is properly authorized before
          entering real student records.
        </div>
      </article>
    </main>
  );
}
