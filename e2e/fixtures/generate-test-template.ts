/**
 * Script to generate test DOCX template for e2e tests
 * Run with: npx ts-node e2e/fixtures/generate-test-template.ts
 */
import fs from 'fs';
import path from 'path';
import { createTestDocxBuffer } from '../../test/helpers/test-docx';

async function generateTestTemplate() {
  console.log('Generating test DOCX template...');

  const buffer = await createTestDocxBuffer();
  const outputPath = path.join(__dirname, 'test-template.docx');

  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ Test template generated at: ${outputPath}`);
  console.log(`   Size: ${buffer.length} bytes`);
  console.log(`   Template fields: {{Account.Name}}, {{GeneratedDate__formatted}}`);
}

generateTestTemplate().catch((error) => {
  console.error('❌ Failed to generate test template:', error);
  process.exit(1);
});
