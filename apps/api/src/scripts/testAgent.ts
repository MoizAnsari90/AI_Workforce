import { supportAgentService } from '../services/supportAgentService';
import { prisma } from '../lib/prisma';

async function test() {
  console.log("--- Testing Support Agent ---");
  const tenantId = "302bcc4b-ddb2-4f99-91ff-7b678f525b09";
  const phone = "923212706830";

  // Ensure conversation aiActive is true for this test number
  await prisma.conversation.upsert({
    where: { tenantId_customerPhone: { tenantId, customerPhone: phone } },
    update: { aiActive: true },
    create: { tenantId, customerPhone: phone, aiActive: true },
  });

  const response = await supportAgentService.processMessage({
    tenantId,
    userMessage: "Hello, what services do you provide",
    fromPhone: phone,
  });
  console.log("Agent Response:", response);
}

test();
