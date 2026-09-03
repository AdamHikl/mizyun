import type { FastifyPluginAsync } from "fastify";

const PAGE_STYLES = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #1e293b;
    background-color: #f8fafc;
    margin: 0;
    padding: 0;
  }
  .container {
    max-width: 800px;
    margin: 40px auto;
    padding: 32px 24px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  }
  .header {
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 20px;
    margin-bottom: 24px;
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 8px 0;
  }
  .subtitle {
    color: #64748b;
    font-size: 14px;
  }
  h2 {
    font-size: 20px;
    font-weight: 600;
    color: #0f172a;
    margin-top: 28px;
    margin-bottom: 12px;
  }
  p, li {
    font-size: 15px;
    color: #334155;
  }
  ul {
    padding-left: 20px;
  }
  .disclaimer-box {
    background-color: #f0fdf4;
    border-left: 4px solid #10b981;
    padding: 16px;
    margin: 20px 0;
    border-radius: 4px;
  }
  .disclaimer-title {
    font-weight: 600;
    color: #065f46;
    margin-bottom: 4px;
  }
  .footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
    font-size: 13px;
    color: #94a3b8;
    text-align: center;
  }
  a {
    color: #2563eb;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;

const renderLayout = (title: string, contentHtml: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Mizyun</title>
  <style>${PAGE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
      <div class="subtitle">Mizyun · Personal Fitness & Nutrition Workspace</div>
    </div>
    ${contentHtml}
    <div class="footer">
      &copy; 2026 Mizyun · <a href="/legal/privacy">Privacy Policy</a> · <a href="/legal/terms">Terms of Service</a> · <a href="/legal/support">Support</a>
    </div>
  </div>
</body>
</html>
`;

export const legalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/privacy", async (_request, reply) => {
    const html = renderLayout(
      "Privacy Policy",
      `
      <p><strong>Last Updated:</strong> September 3, 2026</p>
      <p>Welcome to <strong>Mizyun</strong>. We provide a private fitness, workout, nutrition tracking, and AI-assisted coaching application. We are committed to protecting your personal health and fitness data with strict privacy, database Row Level Security, and user ownership.</p>
      
      <h2>1. Information We Collect</h2>
      <ul>
        <li><strong>Account Information:</strong> Email address for authentication, session restoration, and password recovery.</li>
        <li><strong>Health & Nutrition Data:</strong> Height, birth year, baseline weight, sex at birth, logged foods, calories, macronutrients, and custom goals.</li>
        <li><strong>Training Records:</strong> Exercises, workout routines, completed sets, reps, weight/load, duration, and RPE.</li>
        <li><strong>Body Progress & Photos:</strong> Weight logs, body measurements, and private progress photos stored in encrypted, user-isolated storage.</li>
        <li><strong>AI Interactions:</strong> Contextual queries with the AI Coach and user-controlled durable memories.</li>
      </ul>

      <h2>2. How We Use Your Data</h2>
      <ul>
        <li>Calculating deterministic energy targets (BMR, TDEE, surplus/deficit).</li>
        <li>Tracking workout progression, personal records, and volume over time.</li>
        <li>Providing editable nutrition estimates and grounded coaching recommendations.</li>
      </ul>

      <div class="disclaimer-box">
        <div class="disclaimer-title">🔒 Privacy-First AI Guarantee</div>
        <p style="margin: 0; font-size: 14px; color: #065f46;">
          Your private progress photos and health logs are NEVER used to train third-party public AI models. All AI-generated meal estimates are drafts that require your explicit confirmation before being saved.
        </p>
      </div>

      <h2>3. Data Ownership & Deletion (GDPR / CCPA)</h2>
      <p>You own your data completely. Directly in the Mizyun mobile app under <strong>Account > Settings & Privacy</strong>, you can:</p>
      <ul>
        <li><strong>Export Data:</strong> Download a full JSON archive of all your records.</li>
        <li><strong>Inspect & Delete Memories:</strong> Review and delete individual or all AI memories.</li>
        <li><strong>Delete Account:</strong> Permanently erase your account, login identity, database rows, and media files with instant two-step deletion.</li>
      </ul>

      <h2>4. Contact Us</h2>
      <p>If you have any questions or data requests, please contact us at <a href="mailto:support@phiskel.com">support@phiskel.com</a>.</p>
      `,
    );
    void reply.type("text/html").send(html);
  });

  app.get("/terms", async (_request, reply) => {
    const html = renderLayout(
      "Terms of Service",
      `
      <p><strong>Last Updated:</strong> September 3, 2026</p>
      <p>By using the <strong>Mizyun</strong> application and services, you agree to these Terms of Service.</p>

      <div class="disclaimer-box" style="background-color: #fef2f2; border-left-color: #ef4444;">
        <div class="disclaimer-title" style="color: #991b1b;">⚠️ Important Health & Medical Disclaimer</div>
        <p style="margin: 0; font-size: 14px; color: #7f1d1d;">
          Mizyun is an informational fitness and nutrition tool and is NOT a medical device. Mizyun does not provide medical diagnosis, treatment, or clinical advice. Always consult a qualified physician or healthcare professional before beginning any new training program or diet.
        </p>
      </div>

      <h2>1. Service Description</h2>
      <p>Mizyun provides a private mobile workspace for tracking meals, workouts, body metrics, and receiving AI-assisted drafts and suggestions.</p>

      <h2>2. User Content & Progress Photos</h2>
      <p>You retain 100% ownership of your content and photos. Mizyun hosts your data strictly to display it within your authenticated private account.</p>

      <h2>3. Beta Access & Subscriptions</h2>
      <p>During initial testing and beta periods, premium AI features may be made available complimentary under a Beta Pro Pass. Future commercial access may be subject to subscription plans.</p>

      <h2>4. Account Deletion</h2>
      <p>You can terminate your account and delete all associated data at any time via the in-app Account Settings screen.</p>

      <h2>5. Contact Information</h2>
      <p>For inquiries, please contact <a href="mailto:support@phiskel.com">support@phiskel.com</a>.</p>
      `,
    );
    void reply.type("text/html").send(html);
  });

  app.get("/support", async (_request, reply) => {
    const html = renderLayout(
      "Support & Feedback",
      `
      <h2>Need Help or Have Feedback?</h2>
      <p>We are dedicated to building the most seamless fitness and nutrition experience. If you encounter any bugs, have feature requests, or need assistance with your account, we are here to help.</p>

      <h2>Contact Channels</h2>
      <ul>
        <li><strong>Email Support:</strong> <a href="mailto:support@phiskel.com">support@phiskel.com</a></li>
        <li><strong>In-App Feedback:</strong> Go to <strong>Account > Settings > Send Feedback</strong> to send direct ratings, bug reports, and suggestions.</li>
        <li><strong>Website:</strong> <a href="https://phiskel.com" target="_blank">phiskel.com</a></li>
      </ul>
      `,
    );
    void reply.type("text/html").send(html);
  });
};
