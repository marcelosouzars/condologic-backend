const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// 1. GESTÃO DE CONDOMÍNIOS
// ==========================================

exports.criarCondominio = async (req, res) => {
    const { nome, cnpj, endereco, cidade, estado, tipo_estrutura, valor_m3_agua, valor_m3_gas, dia_corte } = req.body;
    try {
        const query = `
            INSERT INTO tenants (nome, cnpj, endereco, cidade, estado, tipo_estrutura, valor_m3_agua, valor_m3_gas, dia_corte, status_conta)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ativo') RETURNING *;
        `;
        const values = [nome, cnpj, endereco, cidade, estado, tipo_estrutura, valor_m3_agua || 0, valor_m3_gas || 0, dia_corte || 1];
        const result = await pool.query(query, values);
        return res.status(201).json(result.rows[0]);
    } catch (error) { return res.status(500).json({ error: 'Erro ao cadastrar condomínio.' }); }
};

exports.listarCondominios = async (req, res) => {
    const { usuario_id, nivel } = req.query;
    try {
        let query = 'SELECT * FROM tenants ORDER BY nome ASC';
        let values = [];
        if (nivel !== 'master' && usuario_id) {
            query = `SELECT t.* FROM tenants t JOIN user_tenants ut ON t.id = ut.tenant_id WHERE ut.user_id = $1 ORDER BY t.nome ASC`;
            values = [usuario_id];
        }
        const result = await pool.query(query, values);
        return res.json(result.rows);
    } catch (error) { return res.status(500).json({ error: 'Erro ao listar.' }); }
};

exports.editarCondominio = async (req, res) => {
    const { id } = req.params;
    const { nome, endereco, valor_m3_agua, valor_m3_gas, dia_corte } = req.body;
    try {
        const query = `UPDATE tenants SET nome=$1, endereco=$2, valor_m3_agua=$3, valor_m3_gas=$4, dia_corte=$5 WHERE id=$6 RETURNING *`;
        const result = await pool.query(query, [nome, endereco, valor_m3_agua, valor_m3_gas, dia_corte, id]);
        return res.json(result.rows[0]);
    } catch (error) { return res.status(500).json({ error: 'Erro ao editar.' }); }
};

exports.excluirCondominio = async (req, res) => {
    const { id } = req.params;
    try { await pool.query('DELETE FROM tenants WHERE id = $1', [id]); return res.json({ message: 'Excluído.' }); } 
    catch (error) { return res.status(500).json({ error: 'Erro ao excluir.' }); }
};

// ==========================================
// 2. GESTÃO DE USUÁRIOS E EQUIPE
// ==========================================

exports.criarUsuario = async (req, res) => {
    const { nome, cpf, rg, email, telefone, senha, tipo, nivel_acesso, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_estado } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cpfLimpo = cpf.replace(/\D/g, '');
        const query = `
            INSERT INTO users (nome, cpf, rg, email, telefone, senha_hash, tipo, nivel_acesso, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, nome, cpf, tipo;
        `;
        const values = [nome, cpfLimpo, rg, email, telefone, senha, tipo, nivel_acesso, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_estado];
        const result = await client.query(query, values);
        await client.query('COMMIT');
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(400).json({ error: 'CPF ou Email já existe.' });
        return res.status(500).json({ error: 'Erro ao cadastrar.' });
    } finally { client.release(); }
};

// BUSCA INTELIGENTE (CPF ou Nome)
exports.buscarUsuarios = async (req, res) => {
    const { termo } = req.query;
    if (!termo || termo.length < 3) return res.json([]);
    try {
        const termoLimpo = termo.replace(/\D/g, ''); 
        const query = `SELECT id, nome, cpf, tipo FROM users WHERE (nome ILIKE $1 OR cpf LIKE $2) ORDER BY nome ASC LIMIT 10`;
        const result = await pool.query(query, [`%${termo}%`, `%${termoLimpo}%`]);
        return res.json(result.rows);
    } catch (error) { return res.status(500).json({ error: 'Erro na busca.' }); }
};

// LISTAR QUEM TRABALHA NO CONDOMINIO
exports.listarEquipeCondominio = async (req, res) => {
    const { id } = req.params; // ID do condomínio
    try {
        const query = `
            SELECT u.id, u.nome, u.cpf, u.tipo 
            FROM users u
            JOIN user_tenants ut ON u.id = ut.user_id
            WHERE ut.tenant_id = $1
            ORDER BY u.nome ASC
        `;
        const result = await pool.query(query, [id]);
        return res.json(result.rows);
    } catch (error) { return res.status(500).json({ error: 'Erro ao listar equipe.' }); }
};

exports.vincularUsuarioCondominio = async (req, res) => {
    const { user_id, tenant_id } = req.body;
    try {
        await pool.query('INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user_id, tenant_id]);
        res.json({ message: 'Vinculado.' });
    } catch (error) { res.status(500).json({ error: 'Erro ao vincular.' }); }
};

exports.desvincularUsuarioCondominio = async (req, res) => {
    const { user_id, tenant_id } = req.body;
    try {
        await pool.query('DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2', [user_id, tenant_id]);
        res.json({ message: 'Desvinculado.' });
    } catch (error) { res.status(500).json({ error: 'Erro ao desvincular.' }); }
};

exports.listarUsuarios = async (req, res) => {
    try {
        const query = `SELECT u.id, u.nome, u.cpf, u.tipo, u.nivel_acesso, STRING_AGG(t.nome, ', ') as condominios_vinculados FROM users u LEFT JOIN user_tenants ut ON u.id = ut.user_id LEFT JOIN tenants t ON ut.tenant_id = t.id GROUP BY u.id ORDER BY u.nome ASC;`;
        const result = await pool.query(query);
        return res.json(result.rows);
    } catch (error) { return res.status(500).json({ error: 'Erro lista.' }); }
};

exports.editarUsuario = async (req, res) => {
    const { id } = req.params;
    const { nome, email, telefone, tipo, senha } = req.body;
    try {
        let query = '', values = [];
        if (senha && senha.trim() !== '') {
            query = `UPDATE users SET nome=$1, email=$2, telefone=$3, tipo=$4, senha_hash=$5 WHERE id=$6`;
            values = [nome, email, telefone, tipo, senha, id];
        } else {
            query = `UPDATE users SET nome=$1, email=$2, telefone=$3, tipo=$4 WHERE id=$5`;
            values = [nome, email, telefone, tipo, id];
        }
        await pool.query(query, values);
        return res.json({ message: 'Atualizado.' });
    } catch (error) { return res.status(500).json({ error: 'Erro update.' }); }
};

exports.excluirUsuario = async (req, res) => {
    const { id } = req.params;
    try { await pool.query('DELETE FROM users WHERE id = $1', [id]); return res.json({ message: 'Removido.' }); } 
    catch (error) { return res.status(500).json({ error: 'Erro delete.' }); }
};

// ==========================================
// 3. BLOCOS E UNIDADES
// ==========================================
exports.criarBloco = async (req, res) => {
    const { tenant_id, nome } = req.body;
    try { const r = await pool.query('INSERT INTO blocos (tenant_id, nome) VALUES ($1, $2) RETURNING *', [tenant_id, nome]); return res.status(201).json(r.rows[0]); } catch (e) { return res.status(500).json({error:'Erro'}); }
};
exports.listarBlocos = async (req, res) => {
    const { tenant_id } = req.params;
    try { const r = await pool.query('SELECT * FROM blocos WHERE tenant_id = $1 ORDER BY nome ASC', [tenant_id]); return res.json(r.rows); } catch (e) { return res.status(500).json({error:'Erro'}); }
};
exports.criarUnidade = async (req, res) => {
    const { tenant_id, bloco_id, identificacao, andar, criar_medidores } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const u = await client.query('INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id', [tenant_id, bloco_id, identificacao, andar || 'Térreo']);
        const uid = u.rows[0].id;
        if(criar_medidores){ for(const t of criar_medidores) await client.query('INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)', [tenant_id, uid, t]); }
        await client.query('COMMIT'); return res.status(201).json({message:'Criado'});
    } catch(e) { await client.query('ROLLBACK'); return res.status(500).json({error:'Erro'}); } finally { client.release(); }
};
exports.gerarUnidadesLote = async (req, res) => {
    const { tenant_id, bloco_id, andar, inicio, fim, criar_medidores } = req.body;
    if(!inicio || !fim) return res.status(400).json({error:'Intervalo invalido'});
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let c = 0;
        for(let i=parseInt(inicio); i<=parseInt(fim); i++){
            const iden = i.toString();
            const check = await client.query('SELECT id FROM unidades WHERE bloco_id=$1 AND identificacao=$2', [bloco_id, iden]);
            if(check.rows.length===0){
                const u = await client.query('INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id', [tenant_id, bloco_id, iden, andar]);
                const uid = u.rows[0].id;
                if(criar_medidores){ for(const t of criar_medidores) await client.query('INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)', [tenant_id, uid, t]); }
                c++;
            }
        }
        await client.query('COMMIT'); return res.status(201).json({message:`Gerados ${c}`});
    } catch(e) { await client.query('ROLLBACK'); return res.status(500).json({error:'Erro'}); } finally { client.release(); }
};
exports.listarUnidades = async (req, res) => {
    const { bloco_id } = req.params;
    try { const r = await pool.query('SELECT u.*, (SELECT COUNT(*) FROM medidores m WHERE m.unidade_id=u.id) as total_medidores FROM unidades u WHERE u.bloco_id=$1 ORDER BY u.identificacao ASC', [bloco_id]); return res.json(r.rows); } catch (e) { return res.status(500).json({error:'Erro'}); }
};

// ==========================================
// 4. (NOVO) GERADOR DE ESTRUTURA COMPLETA
// ==========================================
exports.gerarEstruturaBloco = async (req, res) => {
    const { tenant_id, nome_bloco, qtde_andares, unidades_por_andar, criar_medidores } = req.body;

    if (!tenant_id || !nome_bloco || !qtde_andares || !unidades_por_andar) {
        return res.status(400).json({ error: 'Dados incompletos para geração.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Criar o Bloco
        const blocoRes = await client.query(
            'INSERT INTO blocos (tenant_id, nome) VALUES ($1, $2) RETURNING id', 
            [tenant_id, nome_bloco]
        );
        const blocoId = blocoRes.rows[0].id;
        let totalCriados = 0;

        // 2. Loop dos Andares
        for (let andar = 1; andar <= parseInt(qtde_andares); andar++) {
            
            // 3. Loop das Unidades por Andar
            for (let seq = 1; seq <= parseInt(unidades_por_andar); seq++) {
                
                // Lógica: Andar 1 + Seq 1 = 101. Andar 13 + Seq 10 = 1310.
                const sufixo = seq < 10 ? `0${seq}` : `${seq}`;
                const identificacao = `${andar}${sufixo}`; 
                const nomeAndar = `${andar}º Andar`;

                // Inserir Unidade
                const u = await client.query(
                    'INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id',
                    [tenant_id, blocoId, identificacao, nomeAndar]
                );
                const uid = u.rows[0].id;

                // 4. Inserir Medidores
                if (criar_medidores && criar_medidores.length > 0) {
                    for (const tipo of criar_medidores) {
                        await client.query(
                            'INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)',
                            [tenant_id, uid, tipo]
                        );
                    }
                }
                totalCriados++;
            }
        }

        await client.query('COMMIT');
        return res.status(201).json({ 
            message: `Sucesso! Bloco '${nome_bloco}' criado com ${totalCriados} unidades.` 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro no Gerador:', error);
        return res.status(500).json({ error: 'Erro ao gerar estrutura.' });
    } finally {
        client.release();
    }
};