import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const permissions = ["customers.view","customers.assign","customers.convert","customers.block","customers.archive","customers.delete","conversations.view_all","staff.view","staff.create","staff.update","admins.view","admins.create","admins.update","permissions.manage","quick_actions.manage","settings.manage","audit.view"];
async function main() {
  for (const key of permissions) await prisma.permission.upsert({ where:{key}, update:{description:key.replaceAll("_"," ").replace(".",": ")}, create:{key,description:key.replaceAll("_"," ").replace(".",": ")} });
  await prisma.settings.upsert({where:{id:1},update:{},create:{id:1,businessName:"Reddy Support",welcomeMessage:"Welcome! How can we help you today?",newClientEvaluationDays:20,archiveEnabled:true,archiveRetentionDays:30,supportOnline:true}});
  const defaults=[{label:"Get support",emoji:"💬",message:"I need help with something.",order:0},{label:"Account help",emoji:"👤",message:"I need help with my account.",order:1},{label:"Report an issue",emoji:"🛠️",message:"I would like to report an issue.",order:2}];
  for(const item of defaults) if(!await prisma.quickAction.findFirst({where:{label:item.label}})) await prisma.quickAction.create({data:{...item,enabled:true,visibility:"BOTH"}});
}
main().finally(()=>prisma.$disconnect());
