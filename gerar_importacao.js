const fs = require('fs');
const path = require('path');

// --- CONFIGURAÇÃO ---
const ARQUIVOS = [
    { nome: 'gas.csv',    tipo_db: 'gas' },
    { nome: 'quente.csv', tipo_db: 'agua_quente' },
    { nome: 'fria.csv',   tipo_db: 'agua_fria' }
];

const TENANT_ID = 1; 
const NOME_CONDOMINIO = "Condomínio Piloto (Importado)";

// Início do SQL
let sqlOutput = `-- SCRIPT DE IMPORTACAO (Arquivos: gas.csv, quente.csv, fria.csv)\n`;
sqlOutput += `DO $$\nDECLARE\n    v_tenant_id INT;\n    v_bloco_id INT;\n    v_unidade_id INT;\n    v_medidor_id INT;\nBEGIN\n`;

sqlOutput += `
    -- Garantir Tenant
    INSERT INTO tenants (id, nome, cnpj, endereco, tipo_estrutura, status_conta)
    VALUES (${TENANT_ID}, '${NOME_CONDOMINIO}', '00.000.000/0001-00', 'Endereço Importado', 'vertical', 'ativo')
    ON CONFLICT (id) DO NOTHING;
    
    v_tenant_id := ${TENANT_ID};
`;

function detectarSeparador(linha) {
    const virgulas = (linha.match(/,/g) || []).length;
    const pontoVirgulas = (linha.match(/;/g) || []).length;
    return pontoVirgulas > virgulas ? ';' : ',';
}

function lerCSV(nomeArquivo) {
    const caminho = path.join(__dirname, nomeArquivo);

    if (!fs.existsSync(caminho)) {
        console.error(`❌ ERRO: O arquivo "${nomeArquivo}" não foi encontrado na pasta!`);
        return [];
    }
    
    console.log(`\n📂 Lendo: ${nomeArquivo}...`);
    
    // Tenta ler o arquivo
    const content = fs.readFileSync(caminho, 'latin1'); // 'latin1' evita erro de acentos bugados do Excel
    const linhas = content.split(/\r?\n/); // Divide linhas lidando com Windows/Mac
    
    if (linhas.length < 2) {
        console.error(`   ⚠️ Arquivo vazio ou sem dados.`);
        return [];
    }

    // Auto-detectar separador baseado no cabeçalho
    const separador = detectarSeparador(linhas[0]);
    console.log(`   🔍 Separador detectado: "${separador}"`);
    console.log(`   👀 Exemplo linha 1: ${linhas[1].substring(0, 50)}...`);

    const dados = [];
    
    for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        if (!linha) continue;
        
        const cols = linha.split(separador);
        
        // Verifica se tem colunas suficientes (ajuste conforme sua planilha)
        if (cols.length < 5) continue; 
        
        // Função para limpar aspas e espaços
        const limpar = (val) => val ? val.replace(/"/g, '').trim() : '';

        // Mapeamento das colunas (IMPORTANTE: Confirme se a ordem bate com sua planilha)
        // 0:Bloco, 1:Unidade, 2:Tipo, 3:Mês, 4:Data, 5:Ant, 6:Atual, 7:Consumo ... 14:Imagem
        dados.push({
            bloco: limpar(cols[0]),
            unidade: limpar(cols[1]),
            mes: limpar(cols[3]),          
            data: limpar(cols[4]),         
            // Troca vírgula por ponto para converter número (ex: "1,552" -> 1.552)
            leitura_ant: parseFloat(limpar(cols[5]).replace(',', '.')) || 0,
            leitura_atual: parseFloat(limpar(cols[6]).replace(',', '.')) || 0,
            consumo: parseFloat(limpar(cols[7]).replace(',', '.')) || 0,
            total: parseFloat(limpar(cols[10]).replace(',', '.')) || 0,
            imagem: cols[14] ? cols[14].trim() : '' 
        });
    }
    console.log(`   ✅ ${dados.length} linhas processadas.`);
    return dados;
}

const blocosProcessados = new Set();
const unidadesProcessadas = new Set();
let totalLeituras = 0;

ARQUIVOS.forEach(arq => {
    const linhas = lerCSV(arq.nome);

    linhas.forEach(l => {
        // Garantir Bloco
        if (!blocosProcessados.has(l.bloco)) {
            sqlOutput += `    INSERT INTO blocos (tenant_id, nome) VALUES (v_tenant_id, '${l.bloco}') ON CONFLICT DO NOTHING;\n`;
            blocosProcessados.add(l.bloco);
        }

        // Garantir Unidade
        const chaveUnidade = `${l.bloco}-${l.unidade}`;
        if (!unidadesProcessadas.has(chaveUnidade)) {
            sqlOutput += `    
    SELECT id INTO v_bloco_id FROM blocos WHERE tenant_id = v_tenant_id AND nome = '${l.bloco}';
    INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES (v_tenant_id, v_bloco_id, '${l.unidade}', '1') ON CONFLICT DO NOTHING;\n`;
            unidadesProcessadas.add(chaveUnidade);
        }

        // Inserir Leitura
        // Corrige formato de data se vier DD/MM/YYYY do Excel para YYYY-MM-DD
        let dataSQL = l.data;
        if (dataSQL.includes('/')) {
            const partes = dataSQL.split('/');
            if (partes.length === 3) dataSQL = `${partes[2]}-${partes[1]}-${partes[0]}`;
        }

        const fotoLimpa = l.imagem.replace(/'/g, "''"); 
        
        sqlOutput += `
    -- ${arq.tipo_db}: ${l.bloco}-${l.unidade}
    SELECT id INTO v_bloco_id FROM blocos WHERE tenant_id = v_tenant_id AND nome = '${l.bloco}';
    SELECT id INTO v_unidade_id FROM unidades WHERE bloco_id = v_bloco_id AND identificacao = '${l.unidade}';
    
    INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo)
    VALUES (v_tenant_id, v_unidade_id, '${arq.tipo_db}', ${l.leitura_atual}, ${l.consumo})
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_medidor_id FROM medidores WHERE unidade_id = v_unidade_id AND tipo = '${arq.tipo_db}' LIMIT 1;

    INSERT INTO leituras (tenant_id, medidor_id, valor_lido, leitura_anterior, consumo, custo_total, mes_referencia, data_leitura, foto_url, origem_dado, status_leitura)
    VALUES (v_tenant_id, v_medidor_id, ${l.leitura_atual}, ${l.leitura_ant}, ${l.consumo}, ${l.total}, '${l.mes}', '${dataSQL}', '${fotoLimpa}', 'importacao_csv', 'processado');
`;
        totalLeituras++;
    });
});

sqlOutput += `END $$;\n`;

fs.writeFileSync('importacao_completa.sql', sqlOutput);

console.log("\n===================================================");
if (totalLeituras > 0) {
    console.log(`✅ SUCESSO! Arquivo 'importacao_completa.sql' gerado.`);
    console.log(`📊 Total de leituras: ${totalLeituras}`);
    console.log("👉 Copie o conteúdo do .sql e rode no NEON.");
} else {
    console.log("❌ ERRO: Nenhuma leitura encontrada. Verifique se os arquivos não estão em branco.");
}
console.log("===================================================");