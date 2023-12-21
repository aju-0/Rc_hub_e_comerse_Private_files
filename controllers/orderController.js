const userDb = require("../models/userModel");
const cartDb = require("../models/cart");
const addressDb = require("../models/userAddress");
const productDb = require("../models/productModel");
const orderDb = require("../models/orderModel");
const couponDb = require("../models/couponModel");
const { ObjectId } = require("mongoose").Types;
const Razorpay = require('razorpay')
const crypto = require("crypto");
const { log } = require("console");

// pdf Generator
const fs = require("fs");
const pdf = require("pdf-creator-node");
const path = require("path");
const options = require("../helpers/options");



var instance = new Razorpay({
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET,
});

const loadCheckOut = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const addressData = await addressDb.findOne({ userId: userId });
    const userData = await userDb.findOne({ _id: userId });
    const cartData = await cartDb
      .findOne({ user: userId })
      .populate("products.productId")
      .exec();
    const products = cartData.products;
    const cart = await cartDb.findOne({ user: userId });
    let cartQuantity = 0;
    if (cart) {
      cartQuantity = cart.products.length;
    }
    const total = await cartDb
      .aggregate([
        {
          $match: { user: new ObjectId(userId) },
        },
        {
          $unwind: "$products",
        },
        {
          $project: {
            price: "$products.price",
            quantity: "$products.quantity",
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $multiply: ["$quantity", "$price"],
              },
            },
          },
        },
      ])
      .exec();

    let stock = [];
    let countCart = [];
    for (let i = 0; i < products.length; i++) {
      stock.push(cartData.products[i].productId.quantity);
      countCart.push(cartData.products[i].quantity);
    }
    let inStock = true;
    let proIndex = 0;
    for (let i = 0; i < stock.length; i++) {
      if (stock[i] > countCart[i] || stock[i] == countCart[i]) {
        inStock = true;
      } else {
        inStock = false;
        proIndex = i;
        break;
      }
    }
    const proName = cartData.products[proIndex].productId.productName;
    if (userId) {
      if (inStock === true) {
        if (addressData) {
          if (addressData.addresses.length > 0) {
            const address = addressData.addresses;

            const Total = total.length > 0 ? total[0].total : 0;

            const totalamount = Total;
            
            res.render("checkout", {
              userId: userId,
              products: products,
              total: Total,
              totalamount,
              user: userData,
              address,
              cartQuantity,
            });
          } else {
            res.redirect("/checkout");
          }
        } else {
          res.redirect(`/edit?id=${req.session.user_id}&message=add%20address`);

        }
      } else {
        res.render("cart", { message: proName, userId: userId, cartQuantity });
      }
    } else {
      res.redirect("/loadLogin");
    }
  } catch (error) {
    console.log(error);
  }
};




const removeAddress = async (req, res) => {
  try {
    // console.log("entered into remove address");

    const id = req.body.id;
    // console.log(id);

    const result = await addressDb.updateOne(
      { userId: req.session.user_id },
      { $pull: { address: { _id: id } } }
    );
    // console.log("result is: ", result);

    res.json({ remove: false });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "An error occurred" });
  }
};





const placeOrder = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const address = req.body.address;
    const cartData = await cartDb.findOne({ user: userId });

    const total = parseInt(req.body.total);
    const paymentMethod = req.body.payment;
    const userData = await userDb.findOne({ _id: userId });
    const name = userData.name;
    const uniNum = Math.floor(Math.random() * 900000) + 100000;
    const status = paymentMethod === "COD" ? "placed" : "pending";
    const statusLevel = status === "placed" ? 1 : 0;
    const walletBalance = userData.wallet;
    let totalWalletBalance = userData.wallet - total;
    const productId = req.query.productId;
    const code = req.body.code;
    const couponData = await couponDb.findOne({ couponCode: code });

 if (cartData.length === 0) {
   console.log("Cart is empty. Please recheck your cart.");
 }

 const today = new Date();
 const deliveryDate = new Date(today);
 deliveryDate.setDate(today.getDate() + 7);

 const cartProducts = cartData.products.map((productItem) => {
   const productSalePrice =
     productItem.discountedPrice || productItem.categoryDiscountedPrice;

   return {
     productId: productItem.productId,
     quantity: productItem.quantity,
     OrderStatus: "Placed",
     productSalePrice: productSalePrice || productItem.price, // Fallback to regular price if no discount
     statusLevel: 1,
     paymentStatus: "Pending",
     "returnOrderStatus.status": "none",
     "returnOrderStatus.reason": "none",
     "cancelOrder.reason": "none",
   };
 });


    

    const order = new orderDb({
      deliveryDetails: address,
      uniqueId: uniNum,
      userId: userId,
      name: name,
      paymentMethod: paymentMethod,
      products: cartProducts,
      totalAmount: total,
      date: new Date(),
      expectedDelivery: deliveryDate,
    });
    const orderData = await order.save();
    const orderid = order._id;

    if (orderData) {
      if (paymentMethod === "COD") {
        const dec = await couponDb.updateOne(
          { couponCode: req.session.code },
          { $inc: { usersLimit: -1 } }
        );
        const userUsed = await couponDb.updateOne(
          { couponCode: req.session.code },
          { $push: { usedUsers: userId } }
        );

        const orderUpdate = await orderDb.findByIdAndUpdate(
          { _id: orderData._id, OrderStatus: "Delivered" },
          { $set: { "products.$[].paymentStatus": "success" } }
        );

        await cartDb.deleteOne({ user: req.session.user_id });
        for (const item of cartData.products) {
          const productId = item.productId._id;
          const quantity = parseInt(item.quantity, 10);
          const result = await productDb.updateOne(
            { _id: productId },
            { $inc: { quantity: -quantity } }
          );
        }

        res.json({ success: true, orderid });

        if (req.session.code) {
          const coupon = await couponDb.findOne({
            couponCode: req.session.code,
          });
          const disAmount = coupon.discountAmount;
          await orderDb.updateOne(
            { _id: orderid },
            { $set: { discount: disAmount } },
            { upsert: true }
          );
          res.json({ success: true, orderid });
        }
      } else {
        const orderId = orderData._id;
        const totalAmount = orderData.totalAmount;

        if (paymentMethod === "onlinePayment") {
          var options = {
            amount: totalAmount * 100,
            currency: "INR",
            receipt: "" + orderId,
          };
          instance.orders.create(options, (error, order) => {
            res.json({ order });
          });
        } else if (paymentMethod === "wallet") {
          const dec = await couponDb.updateOne(
            { couponCode: req.session.code },
            { $inc: { usersLimit: -1 } }
          );
          const userUsed = await couponDb.updateOne(
            { couponCode: req.session.code },
            { $push: { usedUsers: userId } }
          );

          if (walletBalance >= totalAmount) {
            const result = await userDb.findOneAndUpdate(
              { _id: userId },
              {
                $inc: { wallet: -totalAmount },
                $push: {
                  walletHistory: {
                    transactionDate: new Date(),
                    transactionAmount: total,
                    transactionDetails: "Purchased Product Amount .",
                    transactionType: "Debit",
                    currentBalance: totalWalletBalance,
                  },
                },
              },
              { new: true }
            );
            // log('oderid :', orderId)
            const orderUpdate = await orderDb.findByIdAndUpdate(
              { _id: orderId },
              { $set: { "products.$[].paymentStatus": "success" } }
            );

            if (req.session.code) {
              const coupon = await couponDb.findOne({
                couponCode: req.session.code,
              });
              const disAmount = coupon.discountAmount;
              await orderDb.updateOne(
                { _id: orderid },
                { $set: { discount: disAmount } },
                { upsert: true }
              );
              res.json({ success: true, orderid });
            }

            if (result) {
              const updated = await cartDb.deleteOne({
                user: req.session.user_id,
              });
              for (let i = 0; i < cartProducts.length; i++) {
                const productId = cartProducts[i].productId;
                const quantity = cartProducts[i].quantity;
                await productDb.findOneAndUpdate(
                  { _id: productId },
                  { $inc: { quantity: -quantity } }
                );
              }
              res.json({ success: true, orderid });
              log("updated:", updated);
            }
          } else {
            res.json({ walletFailed: true });
          }
        }
      }
    }
  } catch (error) {
    console.log(error);
    res.render("500");
  }
}

const verifyPayment = async (req, res) => {
  try {
    const cartData = await cartDb.findOne({ user: req.session.user_id });
    const products = cartData.products;
    const details = req.body;
    const hmac = crypto.createHmac("sha256", process.env.KEY_SECRET);

    hmac.update(
      details.payment.razorpay_order_id +
        "|" +
        details.payment.razorpay_payment_id
    );
    const hmacValue = hmac.digest("hex");

    if (hmacValue === details.payment.razorpay_signature) {
      for (let i = 0; i < products.length; i++) {
        const productId = products[i].productId;
        const quantity = products[i].quantity;
        await productDb.findByIdAndUpdate(
          { _id: productId },
          { $inc: { quantity: -quantity } }
        );
      }
      const result = await orderDb.findByIdAndUpdate(
        { _id: details.order.receipt },
        { $set: { "products.$[].paymentStatus": "success" } }
      );
      const dec = await couponDb.updateOne(
        { couponCode: req.session.code },
        { $inc: { usersLimit: -1 } }
      );
      const userUsed = await couponDb.updateOne(
        { couponCode: req.session.code },
        { $push: { usedUsers: req.session.user_id } }
      );

      await orderDb.findByIdAndUpdate(
        { _id: details.order.receipt },
        { $set: { paymentId: details.payment.razorpay_payment_id } }
      );
      await cartDb.deleteOne({ user: req.session.user_id });
      const orderid = details.order.receipt;

      if (req.session.code) {
        const coupon = await couponDb.findOne({ couponCode: req.session.code });
        const disAmount = coupon.discountAmount;
        await orderDb.updateOne(
          { _id: orderid },
          { $set: { discount: disAmount } },
          { upsert: true }
        );
        res.json({ codsuccess: true, orderid });
      }

      res.json({ codsuccess: true, orderid });
    } else {
      console.log("details.order.receipt :", details.order.receipt);
      await orderDb.findByIdAndRemove({ _id: details.order.receipt });
      res.json({ success: false });
    }
  } catch (error) {
    console.log(error);
    res.render("500");
  }
};



const orderPlacedPageLoad = async (req, res) => {
  try {
    const userId = req.session.user_id;

    const userData = await userDb.findOne({ _id: userId });
    // console.log("i am here");
    // console.log(userData);

    res.render("orderPlaced", {
      user: userData,
    }); // Pass the order data to the vie
  } catch (error) {
    console.log(error);
  }
};

const loadOrderPage = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const cart = await cartDb.findOne({ user: userId });
    const userData = await userDb.findById({ _id: userId });
    let cartCount = 0;

    if (cart) {
      cartCount = cart.products.lenght;
    }

    const orderData = await orderDb.find({ userId: userId }).sort({ date: -1 });

    // console.log("orderData :",orderData);

    res.render("orders", { user: userData, orders: orderData, cartCount });
  } catch (error) {
    console.log(error);
  }
};

const orderDetails = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const userData = await userDb.findById({ _id: userId });
    
    const id = req.query.id;

    // console.log(id);
    const orderedProduct = await orderDb
      .findOne({ _id: id })
      .populate("products.productId");

    const cart = await cartDb.findOne({ user: req.session.user_id });
    let cartCount = 0;
    // let wishCount=0;
    if (cart) {
      cartCount = cart.products.length;
    }

    res.render("orderDetails", {
      user: userData,
      orders: orderedProduct,
      cartCount,
    });
   } catch (error) {console.log(error.message);
    throw new Error(error);
  }
};

// generating PDF Invoice

const generatePdf = async (req, res, next) => {
  
  const html = fs.readFileSync(
    path.join(__dirname, "../views/users/template.html"),
    "utf-8"
  );
  const filename = Math.random() + "_doc" + ".pdf";

  const userId = req.session.user_id;
  const userData = await userDb.findById({ _id: userId });
  const id = req.query.id;

// console.log(id);
const orderedProduct = await orderDb
  .findOne({ _id: id })
  .populate("products.productId");
//  console.log("orderedProduct:",orderedProduct)

  const cart = await cartDb.findOne({ user: req.session.user_id });
  let cartCount = 0;
  if (cart) {
    cartCount = cart.products.length;
  }
// making passing Data
const userName = userData.name;
const address = orderedProduct.deliveryDetails;
const invoiceId = orderedProduct.uniqueId;
const paymentMethod = orderedProduct.paymentMethod;
const expectedDelivery = orderedProduct.expectedDelivery;
const createdAt = orderedProduct.createdAt;
const totalAmount = orderedProduct.totalAmount;

const currentDate = new Date();

  let array = [];
  let totalSubTotal = 0;
  orderedProduct.products.forEach((d) => {
    // Skip products with OrderStatus "Cancelled"
    if (d.OrderStatus !== "Cancelled") {
      const prod = {
        product: d.productId.productName,
        productCoverPic: d.productId.coverPic[0],
        price: d.productId.price,
        quantity: d.quantity,
        paymentStatus: d.paymentStatus,
        subTotal: d.productId.price * d.quantity,
      };
      array.push(prod);
      totalSubTotal += prod.subTotal;
    }
  });
  



  const obj = {
    invoiceId: invoiceId,
    address: address,
    name: userName,
    paymentMethod: paymentMethod,
    prodlist: array,
    expectedDelivery: expectedDelivery,
    createdAt: createdAt,
    totalAmount: totalSubTotal,
    currentDate: currentDate,
  };
  const document = {
    html: html,
    data: {
      products: obj,
    
    },
    path: "./docs/" + filename,
  };
  pdf
    .create(document, options)
    .then((res) => {
      console.log(res);
    })
    .catch((error) => {
      console.log(error);
    });
  const filepath = "http://localhost:5000/docs/" + filename;

  res.render("download", {
    path: filepath,user:userData

  });
};


const addCheckoutAddress = async (req, res) => {
  try {
    // console.log("entered in to add address");

    const user = req.session.user_id;
    const addressData = await addressDb.findOne({ userId: user });
    // console.log("address data :", addressData);
    if (addressData) {
      const updated = await addressDb.updateOne(
        { userId: user },
        {
          $push: {
            addresses: {
              fullName: req.body.fullName,
              mobile: req.body.mobile,
              country: req.body.country,
              city: req.body.city,
              state: req.body.state,
              pincode: req.body.pincode,
            },
          },
        }
      );
      // console.log(updated);
      if (updated) {
        res.redirect("/checkout");
      } else {
        res.redirect("/checkout");
        // console.log("not added");
      }
    } else {
      res.redirect("/checkout");
    }
  } catch (error) {
    console.log(error);
  }
};

const loadCheckoutEditAddress = async (req, res) => {
  try {
  } catch (error) {
    console.log(error);
  }
};

const editCheckoutAddress = async (req, res) => {
  try {
    // console.log("entere address edit");
    const addressId = req.body.id;
    // console.log("addressId :", addressId);

    const userId = req.session.user_id;
    // console.log(userId);

    const pushAddress = await addressDb.updateOne(
      { userId: userId, "addresses._id": addressId },
      {
        $set: {
          "addresses.$.fullName": req.body.fullName,
          "addresses.$.mobile": req.body.mobile,
          "addresses.$.country": req.body.country,
          "addresses.$.city": req.body.city,
          "addresses.$.state": req.body.state,
          "addresses.$.pincode": req.body.pincode,
        },
      }
    );
    // console.log(pushAddress);
    res.redirect("/checkout");
  } catch (error) {
    console.log(error);
  }
};

const cancelOrder = async (req, res) => {
  try {
   
    const orderId = req.query.orderid;
    console.log("orderId: ", orderId);
    const productIdToCancel = req.query.productId;
     console.log("productIdToCancel   : ", productIdToCancel);
    const userId = req.session.user_id;
    
    const cancelReason = req.body.reason;
    const cancelAmount = req.body.totalPrice;
    const amount = parseInt(cancelAmount);
    const orderData = await orderDb.findOne({ _id: orderId });
    console.log("orderData: ", orderData);

    const userData = await userDb.findOne({});
    let totalWalletBalance = userData.wallet + amount;


    if (orderData.paymentMethod !== "COD") {
      const refundOption = "" + req.body.refundOption;
      
      const result = await userDb.findOneAndUpdate(
        { _id: userId },
        {
          $inc: { wallet: amount },
          $push: {
            walletHistory: {
              transactionDate: new Date(),
              transactionAmount: amount,
              transactionDetails: "Cancelled Product Amount Credited",
              transactionType: "Credit",
              currentBalance: totalWalletBalance,
            },
          },
        },
        { new: true }
      );
     
      if (result) {
       
      } else {
        
      }

      const productInfo = orderData.products.find(
        (product) => String(product.productId) === String(productIdToCancel)
      );
        console.log("productInfo:", productInfo);

      productInfo.OrderStatus = "Cancelled";
      productInfo.paymentStatus = "Refund";
      productInfo.reason = cancelReason;
      productInfo.updatedAt = Date.now();
      await orderData.save();

      const quantity = productInfo.quantity;
      const productId = productInfo.productId;

      const updateQuantity = await productDb.findByIdAndUpdate(
        { _id: productId },
        { $inc: { quantity: quantity } }
      );

      res.redirect("/orders");
    } else if (orderData.paymentMethod === "COD") {
      
      const productInfo = orderData.products.find(
        (product) => String(product.productId) === String(productIdToCancel)
      );

      productInfo.OrderStatus = "Cancelled";
      productInfo.paymentStatus = "Cancelled";
      productInfo.reason = cancelReason;
      productInfo.updatedAt = Date.now();
      await orderData.save();

      const quantity = productInfo.quantity;
      const productId = productInfo.productId;

      const updateQuantity = await productDb.findByIdAndUpdate(
        { _id: productId },
        { $inc: { quantity: quantity } }
      );

      res.redirect("/orders");
    }
   } catch (error) {console.log(error.message);
    throw new Error(error);
  }
};




const productReturn = async (req, res) => {
  try {
    // console.log("entered in product return");
    const orderId = req.query.orderid;

    const returnAmout = req.body.totalPrice;
    const returnReason = req.body.reason;
    const amount = parseInt(returnAmout);
    const orderData = await orderDb.findOne({ _id: orderId });

    const products = orderData.products;
    const userData = await userDb.findOne({});
    let totalWalletBalance = userData.wallet + amount;
    const productIdToCancel = req.query.productId;

    const result = await userDb.findByIdAndUpdate(
      { _id: req.session.user_id },
      {
        $inc: { wallet: amount },
        $push: {
          walletHistory: {
            transactionDate: new Date(),
            transactionAmount: amount,
            transactionDetails: "Returned Product Amount Credited.",
            transactionType: "Credit",
            currentBalance: totalWalletBalance,
          },
        },
      },
      { new: true }
    );

    if (result) {
      let updateQuery;
      if (orderData.paymentMethod === "COD") {
        // Update logic for "cod" payment method
        updateQuery = {
          $set: {
            "products.$.returnOrderStatus.reason": returnReason,
            "products.$.OrderStatus": "Returned",
            "products.$.statusLevel": 6,
            "products.$.paymentStatus": "Refund",
            // Add additional fields for cod payment method if needed
          },
        };
      } else {
        // Default update logic for other payment methods
        updateQuery = {
          $set: {
            "products.$.returnOrderStatus.reason": returnReason,
            "products.$.OrderStatus": "Returned",
            "products.$.statusLevel": 6,
            "products.$.paymentStatus": "Refund",
          },
        };
      }

      const updatedData = await orderDb.updateOne(
        { _id: orderId, "products.productId": productIdToCancel },
        updateQuery
      );

      if (updatedData) {
        for (let i = 0; i < products.length; i++) {
          const productId = products[i].productId;
          const quantity = products[i].quantity;
          await productDb.findByIdAndUpdate(
            { _id: productId },
            { $inc: { quantity: quantity } }
          );
        }
        res.redirect("/orders");
      } else {
        console.log("Order not updated");
      }
    } else {
      console.log("User not found");
    }
  } catch (error) {
    console.log(error);
  }
};



module.exports = {
  loadCheckOut,
  removeAddress,
  placeOrder,
  orderPlacedPageLoad,
  loadOrderPage,
  orderDetails,
  addCheckoutAddress,
  loadCheckoutEditAddress,
  editCheckoutAddress,
  cancelOrder,
  verifyPayment,
  productReturn,
  generatePdf,
};
