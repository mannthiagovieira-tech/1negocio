-- P5.2 · publico jsonb vira contrato estruturado (schema documentado).
COMMENT ON COLUMN va_campanhas.publico IS
'P5.2 CONTRATO: { geo:{modo,cidades:[{nome,meta_key,raio_km}],ufs:[],excluir:[]}, idade_min,idade_max, genero:todos|homens|mulheres, interesses:[{meta_id,nome}], comportamentos:[{meta_id,nome}], advantage_detailed:bool, audiencias:{incluir,excluir}, posicionamentos:automatico, idiomas:[pt_BR] }';

COMMENT ON COLUMN va_arquetipos.abordagem IS
'JSONB · abordagem.segmentacao_meta pode ser string (legado) OU {texto_original:str, termos_busca:[str], publico_resolvido:CONTRATO_P52}';
