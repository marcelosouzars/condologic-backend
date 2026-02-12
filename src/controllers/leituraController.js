const { Pool } = require('pg');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// =====================================================================
// MUDANÇA 1: TROCA DE MODELO (De "flash" para "pro")
// O "pro" é mais lento (2 a 4s), mas a visão computacional é muito superior.
// =====================================================================
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-pro" }) : null;

// ==========================================
// 1. SALVAR LEITURA (COM IA GEMINI PRO)
// ==========================================
exports.salvarLeitura = async (req, res) => {
    const { unidade_id, medidor_id, data_leitura, foto_base64, ignorar_digito, valor_lido } = req.body;
    
    // Valor Manual enviado pelo App (Caso a IA falhe ou usuário digitou)
    const valorApp = parseFloat(valor_lido) || 0;

    let valorFinal = 0;
    let status = 'aguardando_ia';

    console.log(`📥 Processando leitura Medidor ${medidor_id}. Valor App: ${valorApp}`);

    try {
        if (!medidor_id || !foto_base64) {
            return res.status(400).json({ error: 'Foto e ID do medidor são obrigatórios.' });
        }

        // --- TENTATIVA 1: INTELIGÊNCIA ARTIFICIAL (GEMINI 1.5 PRO) ---
        if (model) {
            try {
                // =====================================================================
                // MUDANÇA 2: PROMPT DE ESPECIALISTA
                // Instruções mais claras para ignorar sujeira e números de série.
                // =====================================================================
                const prompt = `
                    Você é um leiturista especialista em hidrômetros e medidores de gás.
                    Sua tarefa: Identificar a leitura numérica atual no mostrador central.
                    
                    DIRETRIZES VISUAIS:
                    1. Foco EXCLUSIVO nos dígitos rolantes (pretos ou vermelhos) dentro do visor.
                    2. IGNORE números estáticos impressos na carcaça plástica ou vidro (números de série).
                    3. IGNORE reflexos, sujeira ou gotas d'água. Tente inferir o número se estiver parcialmente sujo.
                    4. Se o dígito estiver girando entre dois números, escolha o menor (ex: entre 3 e 4, é 3).
                    
                    FORMATO DE SAÍDA:
                    Retorne APENAS os números encontrados. Sem texto, sem explicações. Exemplo: "1456".
                `;

                const base64Data = foto_base64.replace(/^data:image\/\w+;base64,/, "");
                const imagePart = { inlineData: { data: base64Data, mimeType: "image/jpeg" } };

                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                let text = response.text();
                
                // Limpeza extra para garantir que só pegamos números
                let numeros = text.replace(/[^0-9]/g, '');

                if (numeros.length > 0) {
                    // Lógica do "Ignorar último dígito" (Geralmente o vermelho/litros)
                    if (ignorar_digito === true && numeros.length > 1) {
                        numeros = numeros.substring(0, numeros.length - 1);
                    }
                    
                    valorFinal = parseFloat(numeros);
                    status = 'auditado_ia';
                    console.log(`✅ Gemini PRO leu: ${valorFinal} (Texto original: ${text.trim()})`);
                }
            } catch (aiError) {
                console.error("❌ Erro Gemini:", aiError);
            }
        }

        // --- TENTATIVA 2: PLANO B (APP) ---
        // Se a IA falhou (retornou 0 ou erro), usamos o que o zelador digitou
        if (valorFinal === 0 && valorApp > 0) {
            valorFinal = valorApp;
            status = 'conferencia_manual'; // Marca para o síndico ver que a IA falhou
        } else if (valorFinal === 0 && valorApp === 0) {
            status = 'falha_total';
        }

        // Descobre o Tenant (Para manter o isolamento de dados)
        const medidorRes = await pool.query('SELECT tenant_id FROM medidores WHERE id = $1', [medidor_id]);
        let t_id = 1; // Fallback se der erro
        if (medidorRes.rows.length > 0) t_id = medidorRes.rows[0].tenant_id;

        const insertQuery = `
            INSERT INTO leituras (tenant_id, medidor_id, valor_lido, data_leitura, origem_dado, status_leitura, foto_url)
            VALUES ($1, $2, $3, $4, 'mobile_v2', $5, $6)
            RETURNING id;
        `;

        await pool.query(insertQuery, [t_id, medidor_id, valorFinal, data_leitura, status, foto_base64]);

        // Atualiza a leitura anterior do medidor para facilitar a próxima conta
        if (valorFinal > 0) {
            await pool.query('UPDATE medidores SET leitura_anterior = $1 WHERE id = $2', [valorFinal, medidor_id]);
        }

        return res.status(201).json({ message: 'Processado.', valor_final: valorFinal, status: status });

    } catch (error) {
        console.error('❌ Erro Fatal:', error);
        return res.status(500).json({ error: error.message });
    }
};

// ==========================================
// 2. LISTAR LEITURAS (MANTIDO)
// ==========================================
exports.listarLeituras = async (req, res) => {
    const { tenant_id, mes, ano, bloco_id, unidade_id, data_inicio, data_fim } = req.query;
    
    if (!tenant_id) return res.status(400).json({ error: 'ID do condomínio obrigatório' });
    
    try {
        let query = `
            SELECT 
                l.id, 
                l.valor_lido, 
                to_char(l.data_leitura, 'YYYY-MM-DD HH24:MI:SS') as data_iso, 
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

// ==========================================
// 3. EDITAR E EXCLUIR (MANTIDO)
// ==========================================
exports.editarLeitura = async (req, res) => {
    const { id } = req.params;
    const { novo_valor, nova_foto } = req.body; 

    try {
        if (nova_foto) {
            await pool.query("UPDATE leituras SET valor_lido = $1, foto_url = $2, status_leitura = 'corrigido_web' WHERE id = $3", [novo_valor, nova_foto, id]);
        } else {
            await pool.query("UPDATE leituras SET valor_lido = $1, status_leitura = 'corrigido_web' WHERE id = $2", [novo_valor, id]);
        }
        
        const leituraRes = await pool.query('SELECT medidor_id FROM leituras WHERE id = $1', [id]);
        if (leituraRes.rows.length > 0) {
            await pool.query('UPDATE medidores SET leitura_anterior = $1 WHERE id = $2', [novo_valor, leituraRes.rows[0].medidor_id]);
        }
        return res.json({ message: 'Atualizado.' });
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