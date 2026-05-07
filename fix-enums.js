const { createClient } = require('@libsql/client');
const dotenv = require('dotenv');
dotenv.config();
const url = process.env.DATABASE_URL.trim();
const authToken = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();
const client = createClient({ url, authToken: authToken || undefined });

async function main() {
  const fixes = [
    // attachmentStyle
    ['Profile', 'attachmentStyle', 'Secure', 'SECURE'],
    ['Profile', 'attachmentStyle', 'Anxious', 'ANXIOUS'],
    ['Profile', 'attachmentStyle', 'Avoidant', 'AVOIDANT'],
    ['Profile', 'attachmentStyle', 'Fearful', 'FEARFUL_AVOIDANT'],
    ['Profile', 'attachmentStyle', 'Disorganized', 'FEARFUL_AVOIDANT'],
    ['Profile', 'attachmentStyle', 'Fearful-Avoidant', 'FEARFUL_AVOIDANT'],
    // communicationStyle
    ['Profile', 'communicationStyle', 'Expressive', 'EXPRESSIVE'],
    ['Profile', 'communicationStyle', 'Supportive', 'SUPPORTIVE'],
    ['Profile', 'communicationStyle', 'Direct', 'DIRECT'],
    ['Profile', 'communicationStyle', 'Reflective', 'REFLECTIVE'],
    ['Profile', 'communicationStyle', 'Reserved', 'RESERVED'],
    ['Profile', 'communicationStyle', 'Analytical', 'ANALYTICAL'],
    // conflictResolution
    ['Profile', 'conflictResolution', 'Avoiding', 'AVOIDING'],
    ['Profile', 'conflictResolution', 'Avoidant', 'AVOIDING'],
    ['Profile', 'conflictResolution', 'Collaborative', 'COLLABORATIVE'],
    ['Profile', 'conflictResolution', 'Accommodating', 'ACCOMMODATING'],
    ['Profile', 'conflictResolution', 'Compromising', 'COMPROMISING'],
    ['Profile', 'conflictResolution', 'Competing', 'COMPETING'],
    ['Profile', 'conflictResolution', 'Problem-Solving', 'PROBLEM_SOLVING'],
    ['Profile', 'conflictResolution', 'TALK_IT_OUT', 'TALK_IT_OUT'],
    // loveLanguage
    ['Profile', 'loveLanguage', 'Time', 'QUALITY_TIME'],
    ['Profile', 'loveLanguage', 'Quality Time', 'QUALITY_TIME'],
    ['Profile', 'loveLanguage', 'Service', 'ACTS_OF_SERVICE'],
    ['Profile', 'loveLanguage', 'Acts of Service', 'ACTS_OF_SERVICE'],
    ['Profile', 'loveLanguage', 'Words', 'WORDS_OF_AFFIRMATION'],
    ['Profile', 'loveLanguage', 'Words of Affirmation', 'WORDS_OF_AFFIRMATION'],
    ['Profile', 'loveLanguage', 'Gifts', 'GIFTS'],
    ['Profile', 'loveLanguage', 'Touch', 'PHYSICAL_TOUCH'],
    ['Profile', 'loveLanguage', 'Physical Touch', 'PHYSICAL_TOUCH'],
    // emotionalAvailability
    ['Profile', 'emotionalAvailability', 'Fully Available', 'FULLY_AVAILABLE'],
    ['Profile', 'emotionalAvailability', 'Building Trust', 'BUILDING_TRUST'],
    ['Profile', 'emotionalAvailability', 'Processing Past', 'PROCESSING_PAST'],
    ['Profile', 'emotionalAvailability', 'Opening Up', 'OPENING_UP'],
    ['Profile', 'emotionalAvailability', 'Mostly Available', 'MOSTLY_AVAILABLE'],
    ['Profile', 'emotionalAvailability', '3', 'OPENING_UP'],
  ];

  let totalFixed = 0;
  for (const [table, col, oldVal, newVal] of fixes) {
    try {
      const r = await client.execute({
        sql: 'UPDATE ' + table + ' SET ' + col + ' = ? WHERE ' + col + ' = ?',
        args: [newVal, oldVal]
      });
      if (r.rowsAffected > 0) {
        console.log(table + '.' + col + ': ' + oldVal + ' -> ' + newVal + ' (' + r.rowsAffected + ' rows)');
        totalFixed += r.rowsAffected;
      }
    } catch(e) {
      console.log('ERROR: ' + table + '.' + col + ' ' + oldVal + ' -> ' + newVal + ': ' + e.message.slice(0, 80));
    }
  }
  console.log('\nTotal rows fixed: ' + totalFixed);
}

main().catch(e => console.error(e));
