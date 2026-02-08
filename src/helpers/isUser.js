function isUser(req, res, next) {
    if (req.isAuthenticated()) {
        
        return next();
    }

    req.flash('error_msg', 'Você precisa realizar login para acessar essa página');
    res.redirect('/users/login');
}

export default isUser;