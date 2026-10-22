import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const plainPassword = process.env.PLAIN_PASS || process.argv[2];

if (!plainPassword) {
  console.error('❌ Error: Please provide a password via PLAIN_PASS environment variable.');
  console.log('\nUsage:\n  PLAIN_PASS="your_secure_password_here" npx tsx scripts/generateAdminHash.ts\n');
  process.exit(1);
}

if (process.argv[2] && !process.env.PLAIN_PASS) {
  console.warn('⚠️ Warning: Passing password as a CLI argument may expose it in shell command history.');
  console.warn('   Recommended: PLAIN_PASS="your_password" npx tsx scripts/generateAdminHash.ts\n');
}

const saltRounds = 10;
const passHash = bcrypt.hashSync(plainPassword, saltRounds);
const generatedSecret = crypto.randomBytes(32).toString('hex');

console.log('\n=============================================================');
console.log('  CHATLUSTORA — ADMIN CREDENTIAL ENVIRONMENT GENERATOR');
console.log('=============================================================\n');
console.log('Set these environment secrets in your deployment environment:\n');
console.log('ADMIN_USER=admin');
console.log(`ADMIN_PASS_HASH=${passHash}`);
console.log(`JWT_SECRET=${generatedSecret}`);
console.log('\n=============================================================\n');
