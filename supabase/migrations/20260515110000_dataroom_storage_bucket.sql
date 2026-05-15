-- v9.37.0 · bucket Storage para dataroom do projeto + RLS
INSERT INTO storage.buckets (id, name, public)
VALUES ('dataroom', 'dataroom', false)
ON CONFLICT (id) DO NOTHING;

-- Cliente autenticado pode subir arquivos
DROP POLICY IF EXISTS "cliente_upload_dataroom" ON storage.objects;
CREATE POLICY "cliente_upload_dataroom" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'dataroom' AND auth.role() = 'authenticated');

-- Cliente autenticado pode ler arquivos do bucket
DROP POLICY IF EXISTS "cliente_read_dataroom" ON storage.objects;
CREATE POLICY "cliente_read_dataroom" ON storage.objects
FOR SELECT USING (bucket_id = 'dataroom' AND auth.role() = 'authenticated');

-- Cliente autenticado pode atualizar próprios uploads
DROP POLICY IF EXISTS "cliente_update_dataroom" ON storage.objects;
CREATE POLICY "cliente_update_dataroom" ON storage.objects
FOR UPDATE USING (bucket_id = 'dataroom' AND auth.role() = 'authenticated');
