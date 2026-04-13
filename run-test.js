const { execSync } = require('child_process');

console.log('Running tests...');
try {
  // 直接调用jest
  const result = execSync('npx jest tests/integration/product-features.test.ts --no-coverage', {
    stdio: 'inherit',
    cwd: __dirname
  });
  console.log('Tests completed successfully');
} catch (error) {
  console.error('Tests failed:', error.message);
  process.exit(1);
}