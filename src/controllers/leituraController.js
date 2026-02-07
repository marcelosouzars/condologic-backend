const { Pool } = require('pg');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

exports.salvarLeitura = async (req, res) => {
    // SEU CÓDIGO ORIGINAL DA IA MANTIDO INTACTO AQUI
    const { unidade_id, medidor_id, data_leitura, foto_base64, ignorar_digito, valor_lido } = req.body;
    
    // Valor Manual enviado pelo App (pode ser 0 se o usuário não digitou nada)
    const valorApp = parseFloat(valor_lido) || 0;

    let valorFinal = 0;
    let status = 'aguardando_ia';

    console.log(`📥 Processando leitura Medidor ${medidor_id}. Valor App: ${valorApp}`);

    try {
        if (!medidor_id || !foto_base64) {
            return res.status(400).json({ error: 'Foto e ID do medidor são obrigatórios.' });
        }

        // --- TENTATIVA 1: INTELIGÊNCIA ARTIFICIAL (GEMINI) ---
        if (model) {
            try {
                // PROMPT MELHORADO: Focamos no CENTRO e ignoramos periféricos
                const prompt = `
                    Analise esta imagem de um hidrômetro/medidor.
                    Sua tarefa é ler APENAS os dígitos do consumo (leitura).
                    
                    REGRAS CRÍTICAS:
                    1. FOCO NO CENTRO: O número relevante está sempre na área central horizontal da imagem.
                    2. IGNORE BORDAS: Ignore números estampados no metal, na carcaça ou nas extremidades (geralmente são números de série).
                    3. APENAS NÚMEROS: Retorne apenas os dígitos (ex: 1450). Não use letras.
                    4. Se houver números pretos e vermelhos, considere todos.
                `;

                const base64Data = foto_base64.replace(/^data:image\/\w+;base64,/, "");
                
                const imagePart = {
                    inlineData: {
                        data: base64Data,
                        mimeType: "image/jpeg",
                    },
                };

                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                let text = response.text();
                
                // Limpeza bruta (só deixa números)
                let numeros = text.replace(/[^0-9]/g, '');

                if (numeros.length > 0) {
                    // Lógica do Dígito Vermelho
                    if (ignorar_digito === true && numeros.length > 1) {
                        numeros = numeros.substring(0, numeros.length - 1);
                    }
                    
                    valorFinal = parseFloat(numeros);
                    status = 'auditado_ia'; // Sucesso total da IA
                    console.log(`✅ Gemini leu com sucesso: ${valorFinal}`);
                } else {
                    console.log("⚠️ Gemini não viu números nítidos.");
                    // Aqui não zeramos ainda, vamos tentar o Plano B
                }

            } catch (aiError) {
                console.error("❌ Erro no Gemini:", aiError);
                // Erro na IA, vamos pro Plano B
            }
        }

        // --- TENTATIVA 2: PLANO B (VALOR DO APP) ---
        // Se a IA falhou (valorFinal continua 0) MAS o App mandou um valor válido
        if (valorFinal === 0 && valorApp > 0) {
            console.log(`⚠️ Usando valor do App (${valorApp}) pois a IA retornou 0 ou falhou.`);
            valorFinal = valorApp;
            status = 'conferencia_manual'; // Marca que foi salvo, mas precisa de olho humano
        } else if (valorFinal === 0 && valorApp === 0) {
            status = 'falha_total'; // Nem IA, nem App mandaram nada
        }

        // --- PASSO 3: SALVAR ---
        // Descobre o Tenant
        const medidorRes = await pool.query('SELECT tenant_id FROM medidores WHERE id = $1', [medidor_id]);
        let t_id = 1;
        if (medidorRes.rows.length > 0) t_id = medidorRes.rows[0].tenant_id;

        const insertQuery = `
            INSERT INTO leituras (tenant_id, medidor_id, valor_lido, data_leitura, origem_dado, status_leitura, foto_url)
            VALUES ($1, $2, $3, $4, 'mobile_v2', $5, $6)
            RETURNING id;
        `;

        await pool.query(insertQuery, [t_id, medidor_id, valorFinal, data_leitura, status, foto_base64]);

        // Atualiza a leitura anterior
        if (valorFinal > 0) {
            await pool.query('UPDATE medidores SET leitura_anterior = $1 WHERE id = $2', [valorFinal, medidor_id]);
        }

        return res.status(201).json({ 
            message: 'Leitura processada.', 
            valor_final: valorFinal,
            status: status 
        });

    } catch (error) {
        console.error('❌ Erro Fatal:', error);
        return res.status(500).json({ error: error.message });
    }
};

// --- AQUI ESTÁ A MUDANÇA (JOINS PARA EVITAR TELA CINZA) ---
exports.listarLeituras = async (req, res) => {
    const { tenant_id, mes, ano, bloco_id, unidade_id, data_inicio, data_fim } = req.query;
    
    if (!tenant_id) return res.status(400).json({ error: 'ID do condomínio obrigatório' });
    
    try {
        // Query com JOINs para pegar os nomes (evita tela cinza no front)
        let query = `
            SELECT 
                l.id, 
                l.valor_lido, 
                to_char(l.data_leitura, 'YYYY-MM-DD HH24:MI:SS') as data_leitura,
                l.foto_url, 
                l.status_leitura,
                m.tipo as tipo,
                u.identificacao as unidade_nome, 
                b.nome as bloco_nome
            FROM leituras l
            JOIN medidores m ON l.medidor_id = m.id
            JOIN unidades u ON m.unidade_id = u.id
            JOIN blocos b ON u.bloco_id = b.id
            WHERE u.tenant_id = $1
        `;
        const values = [tenant_id];
        let contador = 2;

        // Filtro de Datas
        if (data_inicio && data_fim) {
            query += ` AND l.data_leitura BETWEEN $${contador} AND $${contador+1}`;
            values.push(`${data_inicio} 00:00:00`, `${data_fim} 23:59:59`);
            contador += 2;
        } 
        else if (mes && ano) {
            query += ` AND EXTRACT(MONTH FROM l.data_leitura) = $${contador} AND EXTRACT(YEAR FROM l.data_leitura) = $${contador+1}`;
            values.push(mes, ano);
            contador += 2;
        }

        query += ` ORDER BY l.data_leitura DESC LIMIT 300`;

        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro listar:', error);
        res.status(500).json({ error: 'Erro ao buscar leituras' });
    }
};

exports.editarLeitura = async (req, res) => {
    const { id } = req.params;
    const { novo_valor, nova_foto } = req.body; 

    try {
        if (nova_foto) {
            await pool.query("UPDATE leituras SET valor_lido = $1, foto_url = $2, status_leitura = 'corrigido_web' WHERE id = $3", [novo_valor, nova_foto, id]);
        } else {
            await pool.query("UPDATE leituras SET valor_lido = $1, status_leitura = 'corrigido_web' WHERE id = $2", [novo_valor, id]);
        }
        
        // Atualiza medidor também
        const leituraRes = await pool.query('SELECT medidor_id FROM leituras WHERE id = $1', [id]);
        if (leituraRes.rows.length > 0) {
            await pool.query('UPDATE medidores SET leitura_anterior = $1 WHERE id = $2', [novo_valor, leituraRes.rows[0].medidor_id]);
        }

        return res.json({ message: 'Leitura atualizada.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao corrigir.' });
    }
};

exports.excluirLeitura = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM leituras WHERE id = $1', [id]);
        res.json({ message: 'Excluído' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir.' });
    }
};