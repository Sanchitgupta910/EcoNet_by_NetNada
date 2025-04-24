/**
 * Middleware to authenticate service‐to‐service requests
 * using a shared API key in the `Authorization: ApiKey <key>` header.
 */
import dotenv from 'dotenv';

dotenv.config({
  path: './.env',
});

export function verifyServiceKey(req, res, next) {
  // Expect header: Authorization: ApiKey <your_key>
  const authHeader = req.get('Authorization') || '';
  const [scheme, providedKey] = authHeader.split(' ');

  // Compare to the key stored in environment
  const expectedKey = process.env.WASTE_INGEST_API_KEY;

  if (scheme !== 'ApiKey' || !providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ success: false, message: 'Invalid or missing service API key' });
  }

  // All good—proceed to the controller
  next();
}
