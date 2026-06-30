'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { STORAGE_KEYS, storage } from '@/lib/storage';

interface WishlistContextType {
  wishlistItems: string[];
  addToWishlist: (productId: string) => void;
  removeFromWishlist: (productId: string) => void;
  toggleWishlist: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
  wishlistCount: number;
  clearWishlist: () => void;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlistItems, setWishlistItems] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const savedWishlist = storage.get<string[]>(STORAGE_KEYS.WISHLIST);
    if (savedWishlist) {
      setWishlistItems(savedWishlist);
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      storage.set(STORAGE_KEYS.WISHLIST, wishlistItems);
    }
  }, [wishlistItems, isInitialized]);

  const addToWishlist = (productId: string) => {
    setWishlistItems(prev => {
      if (prev.includes(productId)) {
        return prev;
      }
      return [...prev, productId];
    });
  };

  const removeFromWishlist = (productId: string) => {
    setWishlistItems(prev => prev.filter(id => id !== productId));
  };

  const toggleWishlist = (productId: string) => {
    setWishlistItems(prev => {
      if (prev.includes(productId)) {
        return prev.filter(id => id !== productId);
      }
      return [...prev, productId];
    });
  };

  const isInWishlist = (productId: string): boolean => {
    return wishlistItems.includes(productId);
  };

  const clearWishlist = () => {
    setWishlistItems([]);
  };

  const value: WishlistContextType = {
    wishlistItems,
    addToWishlist,
    removeFromWishlist,
    toggleWishlist,
    isInWishlist,
    wishlistCount: wishlistItems.length,
    clearWishlist,
  };

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (context === undefined) {
    throw new Error('useWishlist must be used within a WishlistProvider');
  }
  return context;
}
