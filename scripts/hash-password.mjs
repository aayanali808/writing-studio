/**
 * Generates the bcrypt hash for AUTH_USER_PASSWORD_HASH.
 *
 * Run: npm run hash-password -- 'your-password-here'
 *
 * Wrap the password in single quotes so the shell doesn't eat $ ! and friends,
 * and note the leading space if you'd rather keep it out of your shell history.
 */
import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash-password -- 'your-password-here'");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

console.log('\nAdd this to .env.local (and to your Vercel env vars):\n');
console.log(`AUTH_USER_PASSWORD_HASH="${hash}"\n`);
