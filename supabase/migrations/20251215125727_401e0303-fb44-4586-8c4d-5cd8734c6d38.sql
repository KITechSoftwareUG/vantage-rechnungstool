-- Create a table for recurring transaction patterns
CREATE TABLE public.recurring_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  description_pattern TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.recurring_patterns ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own patterns" 
ON public.recurring_patterns 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own patterns" 
ON public.recurring_patterns 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own patterns" 
ON public.recurring_patterns 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_recurring_patterns_updated_at
BEFORE UPDATE ON public.recurring_patterns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();