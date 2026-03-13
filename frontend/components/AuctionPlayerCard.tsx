"use client";

interface Props {
  playerName: string;
  playerPhoto?: string;
  basePrice: number;
  currentBid: number;
  currentBidderName?: string;
  timer: number;
  status: string;
}

export default function AuctionPlayerCard({
  playerName,
  playerPhoto,
  basePrice,
  currentBid,
  currentBidderName,
  timer,
  status,
}: Props) {
  const timerColor =
    timer > 30 ? "text-green-400" : timer > 10 ? "text-amber-400" : "text-red-400";

  return (
    <div className="card border-2 border-amber-500/40 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
      <div className="relative">
        <div className="flex justify-between items-start mb-4">
          <div className="flex gap-4 items-center">
            {playerPhoto ? (
              <img src={playerPhoto} alt={playerName} className="w-16 h-16 rounded-full object-cover border-2 border-gray-700 shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center text-2xl text-gray-500 border-2 border-gray-700 shrink-0">
                {(playerName || "?")[0]?.toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">On Auction</p>
              <h2 className="text-3xl font-extrabold">{playerName}</h2>
              <p className="text-gray-500 text-sm mt-1">Base Price: {basePrice}</p>
            </div>
          </div>
          {status === "active" && (
            <div className="text-center">
              <p className={`text-5xl font-mono font-bold ${timerColor}`}>
                {timer.toString().padStart(2, "0")}
              </p>
              <p className="text-xs text-gray-500">seconds</p>
            </div>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <p className="text-gray-400 text-sm mb-1">Current Bid</p>
          <p className="text-4xl font-extrabold text-amber-400">
            {currentBid > 0 ? currentBid : basePrice}
          </p>
          {currentBidderName && (
            <p className="text-gray-400 text-sm mt-2">
              Highest Bidder: <span className="text-white font-semibold">{currentBidderName}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
