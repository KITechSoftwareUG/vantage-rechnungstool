-- Create table to track processed Google Drive files
CREATE TABLE public.processed_drive_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  drive_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  folder_type TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, drive_file_id)
);

-- Enable RLS
ALTER TABLE public.processed_drive_files ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own processed files"
  ON public.processed_drive_files FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own processed files"
  ON public.processed_drive_files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own processed files"
  ON public.processed_drive_files FOR DELETE
  USING (auth.uid() = user_id);