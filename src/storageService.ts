import { supabase } from "./lib/supabase";

export type MonthlyRecord = {
  id?: string;
  competencia: string;
  quantity: number;
  source?: string;
  observation?: string;
};

export type Client = {
  id?: string;
  name: string;
  cnpj?: string;
  erp?: string;
  segment?: string;
  owner?: string;
  notes?: string;
  active?: boolean;
  dashboardActive?: boolean;
  records?: MonthlyRecord[];
  comments?: unknown[];
};

export async function getClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("*, monthly_records(*), comments(*)")
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function saveClient(client: Client) {
  const { data, error } = await supabase
    .from("clients")
    .upsert(client)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClient(client: Client) {
  return saveClient(client);
}

export async function deleteClient(clientId: string) {
  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) throw error;
}

export async function saveMonthlyRecord(clientId: string, record: MonthlyRecord) {
  const { data, error } = await supabase
    .from("monthly_records")
    .upsert({ ...record, client_id: clientId }, { onConflict: "client_id,competencia" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMonthlyRecord(clientId: string, competencia: string) {
  const { error } = await supabase
    .from("monthly_records")
    .delete()
    .eq("client_id", clientId)
    .eq("competencia", competencia);
  if (error) throw error;
}

export async function saveComment(clientId: string, comment: unknown) {
  const { data, error } = await supabase
    .from("comments")
    .insert({ ...(comment as object), client_id: clientId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getComments(clientId: string) {
  const { data, error } = await supabase.from("comments").select("*").eq("client_id", clientId);
  if (error) throw error;
  return data;
}

export async function saveInsight(insight: unknown) {
  const { data, error } = await supabase.from("ai_insights").insert(insight).select().single();
  if (error) throw error;
  return data;
}

export async function getInsights() {
  const { data, error } = await supabase.from("ai_insights").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
