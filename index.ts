import { cloneDeep } from 'lodash'
const FIGMENT_PERSONAL_NODE = 'http://127.0.0.1:8080/'
// eslint-disable-next-line import/named
import {AccountInfo, Connection, ParsedAccountData, PublicKey} from '@solana/web3.js';
import {TokenAmount} from './safe-math'
import {LP_TOKENS, NATIVE_SOL, TokenInfo, TOKENS} from './tokens'

async function main() {
    const conn = new Connection(FIGMENT_PERSONAL_NODE);
    const walletId = '77F8dT4WkWJQbdXtkpV7iSHQBPznU7EzjMM7FWGXHR1o'; // legacy lp
    // const walletId = '3LaMdD7uHQwcBJnxnw5bAmYxvCb9wBKwiZvjKw6iEYRS'; // new lp
    const wallet = new PublicKey(walletId)

    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
    conn.getParsedTokenAccountsByOwner(wallet, {programId: TOKEN_PROGRAM_ID})
        .then(async (parsedTokenAccounts) => {
            const tokenAccounts: any = {}
            for (const tokenAccountInfo of parsedTokenAccounts.value) {
                const tokenAccountPubkey = tokenAccountInfo.pubkey
                const tokenAccountAddress = tokenAccountPubkey.toBase58()
                const parsedInfo = tokenAccountInfo.account.data.parsed.info
                const mintAddress = parsedInfo.mint
                const balance = new TokenAmount(parsedInfo.tokenAmount.amount, parsedInfo.tokenAmount.decimals)
                tokenAccounts[mintAddress] = {
                    tokenAccountAddress,
                    balance
                }

            }
            const solBalance = await conn.getBalance(wallet)
            tokenAccounts[NATIVE_SOL.mintAddress] = {
                tokenAccountAddress: wallet.toBase58(),
                balance: new TokenAmount(solBalance, NATIVE_SOL.decimals)
            }

            let dumpInfo = [];
            for (const [id, r] of Object.entries(tokenAccounts)) {

                const lpInfo = Object.values(LP_TOKENS).find((info) => info.mintAddress === id);
                const tokenInfo = Object.values(TOKENS).find(info => info.mintAddress === id);
                const symbol = lpInfo ? lpInfo.symbol : tokenInfo ? tokenInfo.symbol : '-';
                const userLpBalance = cloneDeep((r as any).balance)
                const decimals = userLpBalance.decimals;
                let balance = 0;
                if( userLpBalance.wei.toString() > 0 )
                    balance = userLpBalance.wei.toString()/(10**decimals);
                dumpInfo.push( {'TOKEN': id, 'BALANCE': balance, SYMBOL: symbol} );
            }

            console.table(dumpInfo);

        });
}


main();
