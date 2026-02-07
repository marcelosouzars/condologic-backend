const { Pool } = require('pg');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

// ==========================================
// 1. SALVAR LEITURA (COM IA GEMINI) - SEU CÓDIGO MANTIDO
// ==========================================
exports.salvarLeitura = async (req, res) => {
    const { unidade_id, medidor_id, data_leitura, foto_base64, ignorar_digito, valor_lido } = req.body;
    
    // Valor Manual enviado pelo App
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
                const prompt = `
                    Analise esta imagem de um hidrômetro/medidor.
                    Sua tarefa é ler APENAS os dígitos do consumo (leitura).
                    REGRAS: FOCO NO CENTRO. IGNORE BORDAS. APENAS NÚMEROS.
                `;

                const base64Data = foto_base64.replace(/^data:image\/\w+;base64,/, "");
                const imagePart = { inlineData: { data: base64Data, mimeType: "image/jpeg" } };

                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                let text = response.text();
                let numeros = text.replace(/[^0-9]/g, '');

                if (numeros.length > 0) {
                    if (ignorar_digito === true && numeros.length > 1) {
                        numeros = numeros.substring(0, numeros.length - 1);
                    }
                    valorFinal = parseFloat(numeros);
                    status = 'auditado_ia';
                    console.log(`✅ Gemini leu: ${valorFinal}`);
                }
            } catch (aiError) {
                console.error("❌ Erro Gemini:", aiError);
            }
        }

        // --- TENTATIVA 2: PLANO B (APP) ---
        if (valorFinal === 0 && valorApp > 0) {
            valorFinal = valorApp;
            status = 'conferencia_manual';
        } else if (valorFinal === 0 && valorApp === 0) {
            status = 'falha_total';
        }

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
// 2. LISTAR LEITURAS (CORRIGIDO PARA O FLUTTER)
// ==========================================
exports.listarLeituras = async (req, res) => {
    const { tenant_id, mes, ano, bloco_id, unidade_id, data_inicio, data_fim } = req.query;
    
    if (!tenant_id) return res.status(400).json({ error: 'ID do condomínio obrigatório' });
    
    try {
        // CORREÇÃO:
        // 1. data_iso: Mandamos a data em formato YYYY-MM-DD para o Flutter entender.
        // 2. unidade_nome / bloco_nome: Alias corretos para o Frontend.
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
// 3. EDITAR E EXCLUIR
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