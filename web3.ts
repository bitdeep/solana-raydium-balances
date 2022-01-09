import {Token} from '@solana/spl-token';

import fetch from 'cross-fetch';

import {initializeAccount} from '@project-serum/serum/lib/token-instructions';



import {
    Account, AccountInfo, Commitment, Connection, PublicKey, SystemProgram, Transaction
} from '@solana/web3.js';

import {
    ASSOCIATED_TOKEN_PROGRAM_ID, RENT_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID
} from './ids';
import {ACCOUNT_LAYOUT, MINT_LAYOUT} from './layouts';
import {TOKENS} from './tokens';

export const web3Config = {
    strategy: 'speed',
    rpcs: [
        {url: 'https://raydium.rpcpool.com', weight: 50},
        {url: 'https://raydium.genesysgo.net', weight: 30},
        {url: 'https://solana-api.projectserum.com', weight: 10},
        {url: 'https://solana-api.tt-prod.net', weight: 10}
    ]
}

// export const commitment: Commitment = 'processed'
export let commitment: Commitment;

// export const commitment: Commitment = 'finalized'

export async function findProgramAddress(seeds: Array<Buffer | Uint8Array>, programId: PublicKey) {
    const [publicKey, nonce] = await PublicKey.findProgramAddress(seeds, programId)
    return {publicKey, nonce}
}

export async function createAmmAuthority(programId: PublicKey) {
    return await findProgramAddress(
        [new Uint8Array(Buffer.from('amm authority'.replace('\u00A0', ' '), 'utf-8'))],
        programId
    )
}

export async function createAssociatedId(infoId: PublicKey, marketAddress: PublicKey, bufferKey: string) {
    const {publicKey} = await findProgramAddress(
        [infoId.toBuffer(), marketAddress.toBuffer(), Buffer.from(bufferKey)],
        infoId
    )
    return publicKey
}

export async function findAssociatedTokenAddress(walletAddress: PublicKey, tokenMintAddress: PublicKey) {
    const {publicKey} = await findProgramAddress(
        [walletAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), tokenMintAddress.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )
    return publicKey
}

export async function findAssociatedStakeInfoAddress(
    poolId: PublicKey,
    walletAddress: PublicKey,
    programId: PublicKey
) {
    const {publicKey} = await findProgramAddress(
        [poolId.toBuffer(), walletAddress.toBuffer(), Buffer.from('staker_info_v2_associated_seed')],
        programId
    )
    return publicKey
}

export async function createTokenAccountIfNotExist(
    connection: Connection,
    account: string | undefined | null,
    owner: PublicKey,
    mintAddress: string,
    lamports: number | null,
    transaction: Transaction,
    signer: Array<Account>
) {
    let publicKey

    if (account) {
        publicKey = new PublicKey(account)
    } else {
        publicKey = await createProgramAccountIfNotExist(
            connection,
            account,
            owner,
            TOKEN_PROGRAM_ID,
            lamports,
            ACCOUNT_LAYOUT,
            transaction,
            signer
        )

        transaction.add(
            initializeAccount({
                account: publicKey,
                mint: new PublicKey(mintAddress),
                owner
            })
        )
    }

    return publicKey
}

export async function createAssociatedTokenAccountIfNotExist(
    account: string | undefined | null,
    owner: PublicKey,
    mintAddress: string,
    transaction: Transaction,
    atas: string[] = []
) {
    let publicKey
    if (account) {
        publicKey = new PublicKey(account)
    }

    const mint = new PublicKey(mintAddress)
    // @ts-ignore without ts ignore, yarn build will failed
    const ata = await Token.getAssociatedTokenAddress(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mint, owner, true)

    if ((!publicKey || !ata.equals(publicKey)) && !atas.includes(ata.toBase58())) {
        transaction.add(
            Token.createAssociatedTokenAccountInstruction(
                ASSOCIATED_TOKEN_PROGRAM_ID,
                TOKEN_PROGRAM_ID,
                mint,
                ata,
                owner,
                owner
            )
        )
        atas.push(ata.toBase58())
    }

    return ata
}

export async function createAtaSolIfNotExistAndWrap(
    connection: Connection,
    account: string | undefined | null,
    owner: PublicKey,
    transaction: Transaction,
    signers: Array<Account>,
    amount: number
) {
    let publicKey
    if (account) {
        publicKey = new PublicKey(account)
    }
    const mint = new PublicKey(TOKENS.WSOL.mintAddress)
    // @ts-ignore without ts ignore, yarn build will failed
    const ata = await Token.getAssociatedTokenAddress(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mint, owner, true)
    if (!publicKey) {
        const rent = await Token.getMinBalanceRentForExemptAccount(connection)
        transaction.add(
            SystemProgram.transfer({fromPubkey: owner, toPubkey: ata, lamports: amount + rent}),
            Token.createAssociatedTokenAccountInstruction(
                ASSOCIATED_TOKEN_PROGRAM_ID,
                TOKEN_PROGRAM_ID,
                mint,
                ata,
                owner,
                owner
            )
        )
    } else {
        const rent = await Token.getMinBalanceRentForExemptAccount(connection)
        const wsol = await createTokenAccountIfNotExist(
            connection,
            null,
            owner,
            TOKENS.WSOL.mintAddress,
            amount + rent,
            transaction,
            signers
        )
        transaction.add(
            Token.createTransferInstruction(TOKEN_PROGRAM_ID, wsol, ata, owner, [], amount),
            Token.createCloseAccountInstruction(TOKEN_PROGRAM_ID, wsol, owner, owner, [])
        )
    }
}

export async function createProgramAccountIfNotExist(
    connection: Connection,
    account: string | undefined | null,
    owner: PublicKey,
    programId: PublicKey,
    lamports: number | null,
    layout: any,
    transaction: Transaction,
    signer: Array<Account>
) {
    let publicKey

    if (account) {
        publicKey = new PublicKey(account)
    } else {
        const newAccount = new Account()
        publicKey = newAccount.publicKey

        transaction.add(
            SystemProgram.createAccount({
                fromPubkey: owner,
                newAccountPubkey: publicKey,
                lamports: lamports ?? (await connection.getMinimumBalanceForRentExemption(layout.span)),
                space: layout.span,
                programId
            })
        )

        signer.push(newAccount)
    }

    return publicKey
}

export async function getFilteredProgramAccounts(
    connection: Connection,
    programId: PublicKey,
    filters: any
): Promise<{ publicKey: PublicKey; accountInfo: AccountInfo<Buffer> }[]> {
    // @ts-ignore
    const resp = await connection._rpcRequest('getProgramAccounts', [
        programId.toBase58(),
        {
            commitment: connection.commitment,
            filters,
            encoding: 'base64'
        }
    ])
    if (resp.error) {
        throw new Error(resp.error.message)
    }
    // @ts-ignore
    return resp.result.map(({pubkey, account: {data, executable, owner, lamports}}) => ({
        publicKey: new PublicKey(pubkey),
        accountInfo: {
            data: Buffer.from(data[0], 'base64'),
            executable,
            owner: new PublicKey(owner),
            lamports
        }
    }))
}

export async function getFilteredProgramAccountsAmmOrMarketCache(
    cacheName: String,
    connection: Connection,
    programId: PublicKey,
    filters: any
): Promise<{ publicKey: PublicKey; accountInfo: AccountInfo<Buffer> }[]> {
    try {
        if (!cacheName) {
            throw new Error('cacheName error')
        }

        const resp = await (await fetch('https://api.raydium.io/cache/rpc/' + cacheName)).json()

        // @ts-ignore
        return resp.result.map(({pubkey, account: {data, executable, owner, lamports}}) => ({
            publicKey: new PublicKey(pubkey),
            accountInfo: {
                data: Buffer.from(data[0], 'base64'),
                executable,
                owner: new PublicKey(owner),
                lamports
            }
        }))
    } catch (e) {
        return getFilteredProgramAccounts(connection, programId, filters)
    }
}

// getMultipleAccounts
export async function getMultipleAccounts(
    connection: Connection,
    publicKeys: PublicKey[],
    commitment?: Commitment
): Promise<Array<null | { publicKey: PublicKey; account: AccountInfo<Buffer> }>> {
    const keys: PublicKey[][] = []
    let tempKeys: PublicKey[] = []

    publicKeys.forEach((k) => {
        if (tempKeys.length >= 100) {
            keys.push(tempKeys)
            tempKeys = []
        }
        tempKeys.push(k)
    })
    if (tempKeys.length > 0) {
        keys.push(tempKeys)
    }

    const accounts: Array<null | {
        executable: any
        owner: PublicKey
        lamports: any
        data: Buffer
    }> = []

    const resArray: { [key: number]: any } = {}
    await Promise.all(
        keys.map(async (key, index) => {
            // @ts-ignore
            const res = await connection.getMultipleAccountsInfo(key, commitment)
            resArray[index] = res
        })
    )

    Object.keys(resArray)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .forEach((itemIndex) => {
            const res = resArray[parseInt(itemIndex)]
            for (const account of res) {
                accounts.push(account)
            }
        })

    return accounts.map((account, idx) => {
        if (account === null) {
            return null
        }
        return {
            publicKey: publicKeys[idx],
            account
        }
    })
}

function throwIfNull<T>(value: T | null, message = 'account not found'): T {
    if (value === null) {
        throw new Error(message)
    }
    return value
}

export async function getMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
    const {data} = throwIfNull(await connection.getAccountInfo(mint), 'mint not found')
    const {decimals} = MINT_LAYOUT.decode(data)
    return decimals
}

export async function getFilteredTokenAccountsByOwner(
    connection: Connection,
    programId: PublicKey,
    mint: PublicKey
): Promise<{ context: {}; value: [] }> {
    // @ts-ignore
    const resp = await connection._rpcRequest('getTokenAccountsByOwner', [
        programId.toBase58(),
        {
            mint: mint.toBase58()
        },
        {
            encoding: 'jsonParsed'
        }
    ])
    if (resp.error) {
        throw new Error(resp.error.message)
    }
    return resp.result
}
