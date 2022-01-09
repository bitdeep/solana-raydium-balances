import { publicKey, u128, u64 } from '@project-serum/borsh';
import { closeAccount } from '@project-serum/serum/lib/token-instructions';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
// @ts-ignore
import { nu64, struct, u8 } from 'buffer-layout';

import { TOKEN_PROGRAM_ID } from './ids';
import {
  getLpMintByTokenMintAddresses, getPoolByLpMintAddress, getPoolByTokenMintAddresses,
  LIQUIDITY_POOLS, LiquidityPoolInfo
} from './pools';
import { TokenAmount } from './safe-math';
import { LP_TOKENS, NATIVE_SOL, TokenInfo, TOKENS } from './tokens';
import {
  commitment, createAssociatedTokenAccountIfNotExist, createTokenAccountIfNotExist,
  getMultipleAccounts
} from './web3';
import { getBigNumber, MINT_LAYOUT } from './layouts';

export { getLpMintByTokenMintAddresses, getPoolByLpMintAddress, getPoolByTokenMintAddresses }

export function getPrice(poolInfo: LiquidityPoolInfo, coinBase = true) {
  const { coin, pc } = poolInfo

  if (!coin.balance || !pc.balance) {
    return new BigNumber(0)
  }

  if (poolInfo.version === 5) {
    const { currentK = 1 } = poolInfo
    const systemDecimal = Math.max(coin.decimals, pc.decimals)
    const k = currentK / (10 ** systemDecimal * 10 ** systemDecimal)
    const y = parseFloat(coin.balance.fixed())
    let price = Math.sqrt(((10 - 1) * y * y) / (10 * y * y - k))
    if (!coinBase) price = 1 / price
    return new BigNumber(price)
  } else if (coinBase) {
    return pc.balance.toEther().dividedBy(coin.balance.toEther())
  } else {
    return coin.balance.toEther().dividedBy(pc.balance.toEther())
  }
}

export function getOutAmount(
  poolInfo: LiquidityPoolInfo,
  amount: string,
  fromCoinMint: string,
  toCoinMint: string,
  slippage: number
) {
  const { coin, pc } = poolInfo

  const price = getPrice(poolInfo)
  const fromAmount = new BigNumber(amount)
  let outAmount = new BigNumber(0)

  const percent = new BigNumber(100).plus(slippage).dividedBy(100)

  if (!coin.balance || !pc.balance) {
    return outAmount
  }

  if (fromCoinMint === coin.mintAddress && toCoinMint === pc.mintAddress) {
    // outcoin is pc
    outAmount = fromAmount.multipliedBy(price)
    outAmount = outAmount.multipliedBy(percent)
  } else if (fromCoinMint === pc.mintAddress && toCoinMint === coin.mintAddress) {
    // outcoin is coin
    outAmount = fromAmount.dividedBy(price)
    outAmount = outAmount.multipliedBy(percent)
  }

  return outAmount
}

export function getOutAmountStable(
  poolInfo: any,
  amount: string,
  fromCoinMint: string,
  toCoinMint: string,
  slippage: number
) {
  const { coin, pc, currentK } = poolInfo
  const systemDecimal = Math.max(coin.decimals, pc.decimals)
  const k = currentK / (10 ** systemDecimal * 10 ** systemDecimal)
  const y = parseFloat(coin.balance.fixed())
  const price = Math.sqrt(((10 - 1) * y * y) / (10 * y * y - k))

  const amountIn = parseFloat(amount)
  let amountOut = 1
  if (fromCoinMint === coin.mintAddress && toCoinMint === pc.mintAddress) {
    // outcoin is pc
    amountOut = amountIn * price
  } else if (fromCoinMint === pc.mintAddress && toCoinMint === coin.mintAddress) {
    // outcoin is coin
    amountOut = amountIn / price
  }

  const amountOutWithSlippage = amountOut / (1 - slippage / 100)

  // const price = Math.sqrt((10 - 1) * y * y /(10 * y * y - k))
  // const afterY = y - amountOut
  // const afterPrice = Math.sqrt((10 - 1) * afterY  * afterY /(10 * afterY * afterY - k))
  // const priceImpact = (beforePrice - afterPrice) / beforePrice * 100

  return new BigNumber(amountOutWithSlippage)
}


export const AMM_INFO_LAYOUT = struct([
  u64('status'),
  u64('nonce'),
  u64('orderNum'),
  u64('depth'),
  u64('coinDecimals'),
  u64('pcDecimals'),
  u64('state'),
  u64('resetFlag'),
  u64('fee'),
  u64('minSize'),
  u64('volMaxCutRatio'),
  u64('pnlRatio'),
  u64('amountWaveRatio'),
  u64('coinLotSize'),
  u64('pcLotSize'),
  u64('minPriceMultiplier'),
  u64('maxPriceMultiplier'),
  u64('needTakePnlCoin'),
  u64('needTakePnlPc'),
  u64('totalPnlX'),
  u64('totalPnlY'),
  u64('systemDecimalsValue'),
  publicKey('poolCoinTokenAccount'),
  publicKey('poolPcTokenAccount'),
  publicKey('coinMintAddress'),
  publicKey('pcMintAddress'),
  publicKey('lpMintAddress'),
  publicKey('ammOpenOrders'),
  publicKey('serumMarket'),
  publicKey('serumProgramId'),
  publicKey('ammTargetOrders'),
  publicKey('ammQuantities'),
  publicKey('poolWithdrawQueue'),
  publicKey('poolTempLpTokenAccount'),
  publicKey('ammOwner'),
  publicKey('pnlOwner')
])

export const AMM_INFO_LAYOUT_V3 = struct([
  u64('status'),
  u64('nonce'),
  u64('orderNum'),
  u64('depth'),
  u64('coinDecimals'),
  u64('pcDecimals'),
  u64('state'),
  u64('resetFlag'),
  u64('fee'),
  u64('min_separate'),
  u64('minSize'),
  u64('volMaxCutRatio'),
  u64('pnlRatio'),
  u64('amountWaveRatio'),
  u64('coinLotSize'),
  u64('pcLotSize'),
  u64('minPriceMultiplier'),
  u64('maxPriceMultiplier'),
  u64('needTakePnlCoin'),
  u64('needTakePnlPc'),
  u64('totalPnlX'),
  u64('totalPnlY'),
  u64('poolTotalDepositPc'),
  u64('poolTotalDepositCoin'),
  u64('systemDecimalsValue'),
  publicKey('poolCoinTokenAccount'),
  publicKey('poolPcTokenAccount'),
  publicKey('coinMintAddress'),
  publicKey('pcMintAddress'),
  publicKey('lpMintAddress'),
  publicKey('ammOpenOrders'),
  publicKey('serumMarket'),
  publicKey('serumProgramId'),
  publicKey('ammTargetOrders'),
  publicKey('ammQuantities'),
  publicKey('poolWithdrawQueue'),
  publicKey('poolTempLpTokenAccount'),
  publicKey('ammOwner'),
  publicKey('pnlOwner'),
  publicKey('srmTokenAccount')
])

export const AMM_INFO_LAYOUT_V4 = struct([
  u64('status'),
  u64('nonce'),
  u64('orderNum'),
  u64('depth'),
  u64('coinDecimals'),
  u64('pcDecimals'),
  u64('state'),
  u64('resetFlag'),
  u64('minSize'),
  u64('volMaxCutRatio'),
  u64('amountWaveRatio'),
  u64('coinLotSize'),
  u64('pcLotSize'),
  u64('minPriceMultiplier'),
  u64('maxPriceMultiplier'),
  u64('systemDecimalsValue'),
  // Fees
  u64('minSeparateNumerator'),
  u64('minSeparateDenominator'),
  u64('tradeFeeNumerator'),
  u64('tradeFeeDenominator'),
  u64('pnlNumerator'),
  u64('pnlDenominator'),
  u64('swapFeeNumerator'),
  u64('swapFeeDenominator'),
  // OutPutData
  u64('needTakePnlCoin'),
  u64('needTakePnlPc'),
  u64('totalPnlPc'),
  u64('totalPnlCoin'),

  u64('poolOpenTime'),
  u64('punishPcAmount'),
  u64('punishCoinAmount'),
  u64('orderbookToInitTime'),

  u128('swapCoinInAmount'),
  u128('swapPcOutAmount'),
  u64('swapCoin2PcFee'),
  u128('swapPcInAmount'),
  u128('swapCoinOutAmount'),
  u64('swapPc2CoinFee'),

  publicKey('poolCoinTokenAccount'),
  publicKey('poolPcTokenAccount'),
  publicKey('coinMintAddress'),
  publicKey('pcMintAddress'),
  publicKey('lpMintAddress'),
  publicKey('ammOpenOrders'),
  publicKey('serumMarket'),
  publicKey('serumProgramId'),
  publicKey('ammTargetOrders'),
  publicKey('poolWithdrawQueue'),
  publicKey('poolTempLpTokenAccount'),
  publicKey('ammOwner'),
  publicKey('pnlOwner')
])

export const AMM_INFO_LAYOUT_STABLE = struct([
  u64('status'),
  publicKey('own_address'),
  u64('nonce'),
  u64('orderNum'),
  u64('depth'),
  u64('coinDecimals'),
  u64('pcDecimals'),
  u64('state'),
  u64('resetFlag'),
  u64('minSize'),
  u64('volMaxCutRatio'),
  u64('amountWaveRatio'),
  u64('coinLotSize'),
  u64('pcLotSize'),
  u64('minPriceMultiplier'),
  u64('maxPriceMultiplier'),
  u64('systemDecimalsValue'),

  u64('ammMaxPrice'),
  u64('ammMiddlePrice'),
  u64('ammPriceMultiplier'),

  // Fees
  u64('minSeparateNumerator'),
  u64('minSeparateDenominator'),
  u64('tradeFeeNumerator'),
  u64('tradeFeeDenominator'),
  u64('pnlNumerator'),
  u64('pnlDenominator'),
  u64('swapFeeNumerator'),
  u64('swapFeeDenominator'),
  // OutPutData
  u64('needTakePnlCoin'),
  u64('needTakePnlPc'),
  u64('totalPnlPc'),
  u64('totalPnlCoin'),
  u128('poolTotalDepositPc'),
  u128('poolTotalDepositCoin'),
  u128('swapCoinInAmount'),
  u128('swapPcOutAmount'),
  u128('swapPcInAmount'),
  u128('swapCoinOutAmount'),
  u64('swapPcFee'),
  u64('swapCoinFee'),

  publicKey('poolCoinTokenAccount'),
  publicKey('poolPcTokenAccount'),
  publicKey('coinMintAddress'),
  publicKey('pcMintAddress'),
  publicKey('lpMintAddress'),
  publicKey('ammOpenOrders'),
  publicKey('serumMarket'),
  publicKey('serumProgramId'),
  publicKey('ammTargetOrders'),
  publicKey('poolWithdrawQueue'),
  publicKey('poolTempLpTokenAccount'),
  publicKey('ammOwner'),
  publicKey('pnlOwner'),

  u128('currentK'),
  u128('padding1'),
  publicKey('padding2')
])

export async function getLpMintInfo(conn: any, mintAddress: string, coin: any, pc: any): Promise<TokenInfo> {
  let lpInfo = Object.values(LP_TOKENS).find((item) => item.mintAddress === mintAddress)
  if (!lpInfo) {
    const mintAll = await getMultipleAccounts(conn, [new PublicKey(mintAddress)], commitment)
    if (mintAll !== null) {
      const data = Buffer.from(mintAll[0]?.account.data ?? '')
      const mintLayoutData = MINT_LAYOUT.decode(data)
      lpInfo = {
        symbol: 'unknown',
        name: 'unknown',
        coin,
        pc,
        mintAddress: mintAddress,
        decimals: mintLayoutData.decimals
      }
    }
  }
  return lpInfo
}

export async function getLpMintListDecimals(
  conn: any,
  mintAddressInfos: string[]
): Promise<{ [name: string]: number }> {
  const reLpInfoDict: { [name: string]: number } = {}
  const mintList = [] as PublicKey[]
  mintAddressInfos.forEach((item) => {
    let lpInfo = Object.values(LP_TOKENS).find((itemLpToken) => itemLpToken.mintAddress === item)
    if (!lpInfo) {
      mintList.push(new PublicKey(item))
      lpInfo = {
        decimals: null
      }
    }
    reLpInfoDict[item] = lpInfo.decimals
  })

  const mintAll = await getMultipleAccounts(conn, mintList, commitment)
  for (let mintIndex = 0; mintIndex < mintAll.length; mintIndex += 1) {
    const itemMint = mintAll[mintIndex]
    if (itemMint) {
      const mintLayoutData = MINT_LAYOUT.decode(Buffer.from(itemMint.account.data))
      reLpInfoDict[mintList[mintIndex].toString()] = mintLayoutData.decimals
    }
  }
  const reInfo: { [name: string]: number } = {}
  for (const key of Object.keys(reLpInfoDict)) {
    if (reLpInfoDict[key] !== null) {
      reInfo[key] = reLpInfoDict[key]
    }
  }
  return reInfo
}

export function getLiquidityInfoSimilar(
  ammIdOrMarket: string | undefined,
  from: string | undefined,
  to: string | undefined
) {
  // const fromCoin = from === NATIVE_SOL.mintAddress ? TOKENS.WSOL.mintAddress : from
  // const toCoin = to === NATIVE_SOL.mintAddress ? TOKENS.WSOL.mintAddress : to
  const fromCoin = from === TOKENS.WSOL.mintAddress ? NATIVE_SOL.mintAddress : from
  const toCoin = to === TOKENS.WSOL.mintAddress ? NATIVE_SOL.mintAddress : to
  const knownLiquidity = LIQUIDITY_POOLS.find((item) => {
    if (fromCoin !== undefined && toCoin != undefined && fromCoin === toCoin) {
      return false
    }
    if (ammIdOrMarket !== undefined && !(item.ammId === ammIdOrMarket || item.serumMarket === ammIdOrMarket)) {
      return false
    }
    if (fromCoin && item.pc.mintAddress !== fromCoin && item.coin.mintAddress !== fromCoin) {
      return false
    }
    if (toCoin && item.pc.mintAddress !== toCoin && item.coin.mintAddress !== toCoin) {
      return false
    }
    if (ammIdOrMarket || (fromCoin && toCoin)) {
      return true
    }
    return false
  })
  return knownLiquidity
}

export function getLiquidityInfo(from: string, to: string) {
  const fromCoin = from === TOKENS.WSOL.mintAddress ? NATIVE_SOL.mintAddress : from
  const toCoin = to === TOKENS.WSOL.mintAddress ? NATIVE_SOL.mintAddress : to
  return LIQUIDITY_POOLS.filter(
    (item) =>
      item.version === 4 &&
      ((item.coin.mintAddress === fromCoin && item.pc.mintAddress === toCoin) ||
        (item.coin.mintAddress === toCoin && item.pc.mintAddress === fromCoin))
  )
}

export function getQueryVariable(variable: string) {
  return undefined
}
