import { supabase } from "@/integrations/supabase/client";

export async function uploadDocument(
  file: File,
  userId: string,
  documentType: "invoices" | "statements"
): Promise<string> {
  const fileExt = file.name.split(".").pop();
  const fileName = `${userId}/${documentType}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(fileName, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("documents").getPublicUrl(fileName);
  return data.publicUrl;
}

export async function processDocumentOCR(
  file: File,
  documentType: "invoice" | "statement"
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", documentType);

  const { data, error } = await supabase.functions.invoke("process-document", {
    body: formData,
  });

  if (error) throw error;
  return data;
}
