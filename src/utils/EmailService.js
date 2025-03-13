import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,

  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function verifyTransporter() {
  try {
    await transporter.verify();
    console.log('SMTP transporter is configured correctly');
  } catch (err) {
    console.error('Error verifying SMTP transporter:', err);
    throw err;
  }
}

/**
 * Sends an invitation email to a new admin user.
 *
 * @param {Object} options - The options for the email.
 * @param {string} options.to - The recipient's email address.
 * @param {string} options.firstName - The name of the recipient.
 * @param {string} options.role - The role assigned to the new admin.
 * @param {string} options.companyName - The name of the company.
 * @param {string} options.userId - The user's login id (email or identifier).
 * @param {string} options.password - The temporary password for the user.
 * @param {string} options.loginLink - The URL where the user can log in.
 */

export async function sendInvitationEmail({ to, firstName, role, companyName, userId, password }) {
  const loginLink = process.env.LOGIN_LINK;
  const emailBody = `
    Hi ${firstName}
    
    You have been added as a ${role} for ${companyName}.

    Your credentials are as follows:
    - User ID: ${userId}
    - Password: ${password}

    Please follow the link to login: ${loginLink}

    Thankyou,
    The EcoNet Team
  `;

  const emailOptions = {
    from: 'process.ENV.FROM_EMAIL',
    to,
    subject: 'Invitation to EcoNet Admin Portal',
    text: emailBody,
  };

  try {
    await transporter.sendMail(emailOptions);
    console.log(`Invitation email sent to ${to}`);
  } catch (err) {
    console.error('Error sending invitation email:', err);
    throw err;
  }
}
