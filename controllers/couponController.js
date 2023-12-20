const couponDb = require("../models/couponModel");
const userDb = require("../models/userModel");
const cartDb = require("../models/cart");

// ===================================================================load Coupon Management page================================================================

const loadCouponMangements = async (req, res) => {
  try {
    const couponItems = await couponDb.find();
    res.render("couponDashboard", {
      couponItems,
      couponAdded: req.session.couponAdded,
    });
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================load add Coupon Management page================================================================

const loadAddCouponMangements = async (req, res) => {
  try {
    res.render("new-coupon");
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================load edit Coupon Management page================================================================

const loadEditCouponMangements = async (req, res) => {
  try {
    const coupon = await couponDb.findOne({ _id: req.query.id });
    res.render("edit-coupon", { coupon: coupon });
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================posting coupon from admin side================================================================

const addNewCoupon = async (req, res) => {
  try {
    console.log(req.body);
    const {
      
      couponName,
      couponCode,
      discountAmount,
      validFrom,
      validTo,
      minimumSpend,
      usersLimit,
      description,
    } = req.body;

    const couponValidation = await couponDb.findOne({ couponCode: couponName });

    if (!couponValidation) {
      const coupon = new couponDb({
        couponName,
        couponCode,
        discountAmount,
        validFrom,
        validTo,
        minimumSpend,
        usersLimit,
        description,
      });
      const result = await coupon.save();

      req.session.couponAdded = 1;
      res.redirect("/admin/couponDashboard");
    } else {
      req.session.couponAdded = 1;
      res.redirect("/admin/couponDashboard");
    }
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================post edit coupon================================================================

const editCoupon = async (req, res) => {
  try {
    const {
      couponName,
      couponCode,
      discountAmount,
      validFrom,
      validTo,
      minimumSpend,
      usersLimit,
      description,
    } = req.body;

    const validFromDate = validFrom;
    const validToDate = validTo;

    const updateCoupon = await couponDb.updateOne(
      { _id: req.query.id },
      {
        $set: {
          couponName: couponName,
          couponCode: couponCode,
          discountAmount: discountAmount,
          validFrom: validFromDate,
          validTo: validToDate,
          minimumSpend: minimumSpend,
          usersLimit: usersLimit,
          description: description,
        },
      }
    );

    return res.redirect("/admin/couponDashboard");
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================delete individual coupons ================================================================

const deleteCoupon = async (req, res) => {
  try {
    const deleteCoupon = await couponDb.deleteOne({ _id: req.query.id });
    return res.redirect("/admin/couponDashboard");
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================user side load the coupon page================================================================


// ===================================================================apply coupon in to each product================================================================

const ApplyCoupon = async (req, res) => {
  try {
    const userId = req.session.user_id;

    const code = req.body.code;

    req.session.code = code;
    const amount = Number(req.body.amount);

    const cartData = await cartDb
      .findOne({ user: userId })
      .populate("products.productId");

    let totalPrice = 0;
    const userExist = await couponDb.findOne({
      couponCode: code,
      usedUsers: { $in: [userId] },
    });

    if (cartData) {
      if (cartData.products.length > 0) {
        const products = cartData.products;

        console.log(products,"+++++++++++++++++++++");

        for (const product of cartData.products) {
          console.log(product.quantity,"****",product.price);
          totalPrice += product.quantity * product.price;
          console.log(("Toatal Prize:",totalPrice));
        }
      }
    }

    if (userExist) {
      res.json({ user: true });
    } else {
      const couponData = await couponDb.findOne({ couponCode: code });

      if (couponData) {
        if (couponData.usersLimit <= 0) {
          res.json({ limit: true });
        } else {
          if (couponData.status == false) {
            res.json({ status: true });
          } else {
            if (couponData.expiryDate <= new Date()) {
              res.json({ date: true });
            } else if (couponData.activationDate >= new Date()) {
              res.json({ active: true });
            } else {
              if (couponData.minimumSpend >= amount) {
                res.json({ cartAmount: true });
              } else {
                const disAmount = couponData.discountAmount;

                const disTotal = Math.round(totalPrice - disAmount);

                req.session.Amount = disTotal;
                const aplleid = await cartDb.updateOne(
                  { user: userId },
                  { $set: { applied: "applied" } }
                );

                return res.json({ amountOkey: true, disAmount, disTotal });
              }
            }
          }
        }
      } else {
        res.json({ invalid: true });
      }
    }
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

// ===================================================================func for deleting the each coupons================================================================

const deleteAppliedCoupon = async (req, res) => {
  try {
    const userId = req.session.userId;

    const code = req.body.code;
    const couponData = await couponDb.findOne({ couponCode: code });
    const amount = Number(req.body.amount);
    const disAmount = couponData.discountAmount;
    const disTotal = Math.round(amount + disAmount);
    const deleteApplied = await cartDb.updateOne(
      { user: userId },
      { $set: { applied: "not" } }
    );
    if (deleteApplied) {
      res.json({ success: true, disTotal });
    }
  } catch (error) {
    console.log(error.message);
    throw new Error(error);
  }
};

module.exports = {
  loadCouponMangements,
  loadAddCouponMangements,
  loadEditCouponMangements,
  addNewCoupon,
  editCoupon,
  deleteCoupon,
  
  ApplyCoupon,
  deleteAppliedCoupon,
};
