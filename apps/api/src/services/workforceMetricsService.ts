import { WorkforcePeriod, requestsSpecificPeriod } from './workforcePeriod';

export interface WorkforceMetrics {
  inventoryCount: number;
  lowStockAlerts: number;
  pendingApprovals: number;
  completedAgentTasks: number;
  totalTasks: number;
  inboundCustomerMessages: number;
  aiOutboundReplies: number;
  aiRepliesPer100Inbound: number | null;
}

// These are database totals, not an inferred count of uniquely answered messages.
// Always state the period because this endpoint has no date-range filter.
export function answerVerifiedMetrics(question: string, metrics: WorkforceMetrics, period?: WorkforcePeriod | null): string | null {
  if (requestsSpecificPeriod(question)) {
    if (!period) return 'I could not identify that date range. Use today, yesterday, this week, last week, this month, last month, or a date such as 2026-10-01.';
    const during = 'During ' + period.label + ', ';
    if (/\b(ai|assistant)\b/i.test(question) && /\b(repl\w*|jawab|answer\w*|respond\w*)\b/i.test(question)) {
      return `${during}${metrics.aiOutboundReplies} AI outbound replies and ${metrics.inboundCustomerMessages} inbound customer messages were recorded. Reply count does not represent unique customer messages answered.`;
    }
    if (/\b(approvals?)\b/i.test(question)) return `${during}${metrics.pendingApprovals} approval requests created in this period are still pending.`;
    if (/\b(tasks?)\b/i.test(question) && /\b(complet\w*|done|mukammal)\b/i.test(question)) return `${during}${metrics.completedAgentTasks} agent-assigned tasks were completed, out of ${metrics.totalTasks} tasks created in this period.`;
    if (/\b(tasks?)\b/i.test(question)) return `${during}${metrics.totalTasks} tasks were created; ${metrics.completedAgentTasks} agent-assigned tasks were completed in this period.`;
    if (/\b(stock|inventory)\b/i.test(question) && /\b(alerts?)\b/i.test(question)) return `${during}${metrics.lowStockAlerts} low-stock alerts created in this period are currently open. This counts workspace alerts, not live Shopify inventory.`;
    if (/\b(summary|summarize|overview|khulasa)\b/i.test(question)) return `${during}${metrics.completedAgentTasks} agent tasks were completed; ${metrics.totalTasks} tasks and ${metrics.inboundCustomerMessages} inbound messages were recorded. ${metrics.aiOutboundReplies} AI replies were sent, ${metrics.pendingApprovals} period approvals remain pending, and ${metrics.lowStockAlerts} period low-stock alerts remain open.`;
    return 'Date-filtered counts are available for AI replies, tasks, approvals and low-stock alerts. Ask about one of those for ' + period.label + '.';
  }
  const allTime = 'Workspace totals (all time): ';
  if (/\b(ai|assistant)\b/i.test(question) && /\b(repl\w*|jawab|answer\w*|respond\w*)\b/i.test(question)) {
    return `${allTime}${metrics.aiOutboundReplies} AI outbound replies and ${metrics.inboundCustomerMessages} inbound customer messages are recorded. Reply count does not represent unique customer messages answered.`;
  }
  if (/\b(approvals?)\b/i.test(question) && /\b(pending|kitn[aei]|how many|count)\b/i.test(question)) {
    return `Currently ${metrics.pendingApprovals} approvals are pending.`;
  }
  if (/\b(tasks?)\b/i.test(question) && /\b(complet\w*|done|mukammal)\b/i.test(question)) {
    return `${allTime}${metrics.completedAgentTasks} agent-assigned tasks are completed, out of ${metrics.totalTasks} total tasks.`;
  }
  if (/\b(tasks?)\b/i.test(question) && /\b(total|kitn[aei]|how many|count)\b/i.test(question)) {
    return `${allTime}${metrics.totalTasks} tasks are recorded.`;
  }
  if (/\b(stock|inventory)\b/i.test(question) && /\b(alerts?)\b/i.test(question)) {
    return `Currently ${metrics.lowStockAlerts} low-stock alerts are open in the workspace database. This is not a live Shopify inventory check.`;
  }
  if (/\b(summary|summarize|overview|khulasa)\b/i.test(question)) {
    return `${allTime}${metrics.completedAgentTasks} completed agent tasks, ${metrics.totalTasks} total tasks, ${metrics.aiOutboundReplies} AI outbound replies and ${metrics.inboundCustomerMessages} inbound customer messages. Currently ${metrics.pendingApprovals} approvals are pending and ${metrics.lowStockAlerts} low-stock alerts are open.`;
  }
  return null;
}
